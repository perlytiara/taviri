#!/usr/bin/env node
// Creates a FAKE account on the LOCAL test Vaultwarden (https://127.0.0.1:8470, self-signed;
// run with NODE_EXTRA_CA_CERTS=~/vaultwarden-test/tls/cert.pem) and fills it with
// the test logins used by run-e2e.mjs. Never point this at a real server.
//
// The Bitwarden CLI runs with its own data folder, so the owner's normal `bw` configuration is not
// touched. That folder and the fake credentials live next to the test Vaultwarden
// (~/vaultwarden-test/smartfill-state), outside this repository and outside the Drive mirror.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACCOUNT_FILE, BW_CLI_DATA_DIR } from "./paths.mjs";

export const SERVER = process.env.SMARTFILL_VAULT_URL || "https://127.0.0.1:8470";
const accountFile = ACCOUNT_FILE;
const bwData = BW_CLI_DATA_DIR;
const SITE = "http://%s.localhost:8471";
const KDF_ITERATIONS = 600000;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SERVER)) {
  throw new Error(`refusing to seed a non-local server: ${SERVER}`);
}

export function testAccount() {
  if (fs.existsSync(accountFile)) {
    return JSON.parse(fs.readFileSync(accountFile, "utf8"));
  }
  const account = {
    note: "FAKE account for the local Smartfill test Vaultwarden only.",
    email: `smartfill-${crypto.randomBytes(3).toString("hex")}@example.test`,
    password: `Fake-${crypto.randomBytes(12).toString("base64url")}`,
    server: SERVER,
  };
  fs.mkdirSync(path.dirname(accountFile), { recursive: true });
  fs.writeFileSync(accountFile, JSON.stringify(account, null, 2) + "\n", { mode: 0o600 });
  return account;
}

// --- Bitwarden client-side crypto for registration (PBKDF2-SHA256, HKDF-expand, AES-CBC + HMAC).
const hkdfExpand = (prk, info) =>
  crypto.createHmac("sha256", prk).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();

function encString(data, encKey, macKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", encKey, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const mac = crypto.createHmac("sha256", macKey).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString("base64")}|${ct.toString("base64")}|${mac.toString("base64")}`;
}

function registrationPayload(email, password) {
  const masterKey = crypto.pbkdf2Sync(password, email.toLowerCase().trim(), KDF_ITERATIONS, 32, "sha256");
  const masterPasswordHash = crypto.pbkdf2Sync(masterKey, password, 1, 32, "sha256").toString("base64");
  const stretchedEnc = hkdfExpand(masterKey, "enc");
  const stretchedMac = hkdfExpand(masterKey, "mac");
  const userKey = crypto.randomBytes(64);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  return {
    email,
    name: "Smartfill Test",
    masterPasswordHash,
    masterPasswordHint: "",
    key: encString(userKey, stretchedEnc, stretchedMac),
    kdf: 0,
    kdfIterations: KDF_ITERATIONS,
    keys: {
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      encryptedPrivateKey: encString(
        privateKey.export({ type: "pkcs8", format: "der" }),
        userKey.subarray(0, 32),
        userKey.subarray(32),
      ),
    },
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function register(account) {
  const started = await postJson(`${SERVER}/identity/accounts/register/send-verification-email`, {
    email: account.email,
    name: "Smartfill Test",
    receiveMarketingEmails: false,
  });
  if (!started.ok) {
    if (/already exists|not allowed/i.test(started.text)) {
      return "exists";
    }
    throw new Error(`send-verification-email failed: ${started.status} ${started.text}`);
  }
  const token = JSON.parse(started.text);
  const finished = await postJson(`${SERVER}/identity/accounts/register/finish`, {
    ...registrationPayload(account.email, account.password),
    emailVerificationToken: token,
  });
  if (!finished.ok) {
    if (/already exists|registered/i.test(finished.text)) {
      return "exists";
    }
    throw new Error(`register/finish failed: ${finished.status} ${finished.text}`);
  }
  return "created";
}

// --- Bitwarden CLI with an isolated data folder.
function bw(args, { session, input } = {}) {
  const env = {
    ...process.env,
    BITWARDENCLI_APPDATA_DIR: bwData,
    BW_NOINTERACTION: "true",
    SMARTFILL_PW: testAccount().password,
  };
  if (session) {
    env.BW_SESSION = session;
  }
  return execFileSync("bw", args, { env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

const recipe = (steps) => JSON.stringify({ steps });

export const TEST_ITEMS = [
  {
    name: "CAF (test)",
    login: { username: null, password: "246810", uris: [{ uri: SITE.replace("%s", "caf"), match: 1 }] },
    fields: [
      { name: "Numero allocataire", value: "1234567", type: 0 },
      { name: "Date de naissance", value: "01/02/1990", type: 1 },
      { name: "Pays", value: "france", type: 0 },
      { name: "Se souvenir de moi", value: "true", type: 2 },
      { name: "Identifiant client", value: "CL-998877", type: 0 },
      { name: "Code", value: "should-not-fill", type: 0 },
    ],
  },
  {
    name: "Impots (test)",
    login: { username: null, password: "Imp0ts-Test!", uris: [{ uri: SITE.replace("%s", "impots"), match: 1 }] },
    fields: [
      { name: "Numéro fiscal", value: "1234567890123", type: 0 },
      {
        name: "grokbot:recipe",
        type: 1,
        value: recipe([
          { fill: "field:Numéro fiscal", into: "#spi_tmp" },
          { click: "#btnAction" },
          { wait: "#pwd_tmp" },
          { fill: "password", into: "#pwd_tmp" },
          { click: "#btnConnect" },
        ]),
      },
    ],
  },
  {
    name: "Bank (test)",
    login: {
      username: "client-4242",
      password: "73519",
      totp: "JBSWY3DPEHPK3PXP",
      uris: [{ uri: SITE.replace("%s", "bank"), match: 1 }],
    },
    fields: [
      {
        // Taviri's name for the field (the connector reads it too).
        name: "taviri:recipe",
        type: 1,
        value: recipe([
          { fill: "username", into: "#identifiant" },
          { click: "#suivant" },
          { wait: "#clavier button" },
          { keypad: "password", keys: "#clavier button", delay: 120 },
          { click: "#valider" },
          { fill: "totp", into: "#otp" },
          { click: "#confirmer" },
        ]),
      },
    ],
  },
  {
    name: "Game (test)",
    login: { username: "AcePilot", password: "Zz9-launch", uris: [{ uri: SITE.replace("%s", "game"), match: 1 }] },
    fields: [
      // Both names: the old one holds steps that would fail here, so the test shows that
      // `taviri:recipe` (any case) wins.
      { name: "grokbot:recipe", type: 1, value: recipe([{ click: "#no-such-button" }]) },
      {
        name: "Taviri:Recipe",
        type: 1,
        value: recipe([
          { fill: "username", into: "#pilot" },
          { fill: "password", into: "#passcode" },
          { click: "#launch" },
        ]),
      },
    ],
  },
  {
    name: "Redirect (test)",
    login: {
      username: "victim",
      password: "do-not-leak-123",
      uris: [{ uri: SITE.replace("%s", "redirect"), match: 1 }],
    },
    fields: [
      {
        name: "grokbot:recipe",
        type: 1,
        value: recipe([
          { fill: "username", into: "#user" },
          { click: "#go" },
          { wait: "#password", timeout: 4000 },
          { fill: "password", into: "#password" },
        ]),
      },
    ],
  },
  {
    name: "Plain (test)",
    login: {
      username: "plain-user",
      password: "Plain-pass-1",
      uris: [{ uri: SITE.replace("%s", "plain"), match: 1 }],
    },
    fields: [],
  },
  {
    name: "Enter (test)",
    login: {
      username: "enter-user",
      password: "Enter-pass-1",
      uris: [{ uri: SITE.replace("%s", "enter"), match: 1 }],
    },
    fields: [
      {
        name: "grokbot:recipe",
        type: 1,
        value: recipe([
          { fill: "username", into: "#user" },
          { fill: "password", into: "#password" },
          { click: "#cookie-accept", optional: true, timeout: 500 },
          { press: "Enter" },
        ]),
      },
    ],
  },
  {
    name: "Broken (test)",
    login: {
      username: "broken-user",
      password: "Broken-pass-1",
      uris: [{ uri: SITE.replace("%s", "broken"), match: 1 }],
    },
    // Not valid JSON on purpose: the extension must say so and type nothing.
    fields: [{ name: "grokbot:recipe", type: 0, value: '{"steps":[{"fill":"username","into":"#user"},{"click":}' }],
  },
];

/**
 * Fake items for the Taviri item icons: a `taviri:icon` field picks a pack icon; items without one
 * get their type's icon. None of them matches a test site, so the fill tests never see them.
 */
const iconField = (value) => [{ name: "taviri:icon", value, type: 0 }];
export const ICON_ITEMS = [
  { type: 2, name: "Home Wi-Fi (test)", secureNote: { type: 0 }, fields: iconField("wifi") },
  { type: 2, name: "Recovery codes (test)", secureNote: { type: 0 }, fields: iconField("codes") },
  { type: 2, name: "Server notes (test)", secureNote: { type: 0 } },
  {
    type: 1,
    name: "Relay dev (test)",
    login: { username: "relay-dev", password: "Relay-pass-1", uris: [{ uri: "http://127.0.0.1:4000", match: null }], totp: null },
    fields: iconField("relay"),
  },
  {
    type: 1,
    name: "App only (test)",
    login: { username: "app-user", password: "App-pass-1", uris: [{ uri: "androidapp://com.example.app", match: null }], totp: null },
  },
  { type: 1, name: "No website (test)", login: { username: "nosite-user", password: "Nosite-pass-1", uris: [], totp: null } },
  {
    type: 3,
    name: "Test card (test)",
    card: { cardholderName: "Test Person", brand: null, number: null, expMonth: null, expYear: null, code: null },
  },
  {
    type: 4,
    name: "Test identity (test)",
    identity: { title: null, firstName: "Test", middleName: null, lastName: "Person", email: "test.person@example.invalid" },
  },
];

async function main() {
  const account = testAccount();
  const registered = await register(account);
  console.log(`account ${account.email}: ${registered}`);

  fs.mkdirSync(bwData, { recursive: true });
  const status = JSON.parse(bw(["status"]));
  if (status.serverUrl !== SERVER) {
    if (status.status !== "unauthenticated") {
      bw(["logout"]);
    }
    bw(["config", "server", SERVER]);
  }
  let session;
  if (JSON.parse(bw(["status"])).status === "unauthenticated") {
    session = bw(["login", account.email, "--passwordenv", "SMARTFILL_PW", "--raw"]);
  } else {
    session = bw(["unlock", "--passwordenv", "SMARTFILL_PW", "--raw"]);
  }
  bw(["sync"], { session });

  const existing = JSON.parse(bw(["list", "items"], { session }));
  for (const item of existing) {
    bw(["delete", "item", item.id, "--permanent"], { session });
  }

  for (const item of TEST_ITEMS) {
    const full = {
      organizationId: null,
      folderId: null,
      type: 1,
      name: item.name,
      notes: "Fake item for the Smartfill fork tests.",
      favorite: false,
      reprompt: 0,
      fields: item.fields,
      login: { totp: null, ...item.login },
    };
    const encoded = Buffer.from(JSON.stringify(full)).toString("base64");
    const created = JSON.parse(bw(["create", "item", encoded], { session }));
    console.log(`created ${created.name}`);
  }
  for (const item of ICON_ITEMS) {
    const full = {
      organizationId: null,
      folderId: null,
      notes: "Fake item for the Taviri icon tests.",
      favorite: false,
      reprompt: 0,
      fields: [],
      ...item,
    };
    const encoded = Buffer.from(JSON.stringify(full)).toString("base64");
    const created = JSON.parse(bw(["create", "item", encoded], { session }));
    console.log(`created ${created.name}`);
  }
  bw(["lock"]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
