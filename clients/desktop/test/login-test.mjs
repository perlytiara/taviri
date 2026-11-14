#!/usr/bin/env node
// Login test for the installed Taviri.app against the throwaway Vaultwarden on
// https://127.0.0.1:8470 (fake account only; see clients/extension/test/).
//
//   node test/login-test.mjs [--app ~/Applications/Taviri.app] [--login-screen-only] [--show]
//   node test/login-test.mjs --cleanup-only   log the test account out of the last run's data
//
// By default the app starts the way it does at login (--autostart): window hidden, no Dock
// icon, only its menu bar icon shows while the test runs, and the front app does not change.
// --show opens the window normally (only when the Mac is idle: it takes focus).
//
// Isolated from everything real: its own data folder (BITWARDEN_APPDATA_DIR), its own
// throwaway browser profile for the bridge manifests (BITWARDEN_CHROME_PROFILE_DIR), Chromium's
// mock keychain (no "Taviri Safe Storage" item in the login keychain), and the self-signed test
// certificate accepted only in this run (--ignore-certificate-errors). The app is driven over
// the Chrome DevTools protocol, not with clicks on the screen, but its window does appear.
// Screenshots: test/results/.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.dirname(HERE);
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, "clients", "node_modules", "playwright"));

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const brand = JSON.parse(
  fs.readFileSync(path.join(ROOT, "clients", "apps", "browser", "webpack", "smartfill-brand", "brand.json"), "utf8"),
);
const appPath = option("app", path.join(os.homedir(), "Applications", `${brand.name}.app`));
const exe = path.join(appPath, "Contents", "MacOS", brand.name);
const account = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), "Developer", "vaultwarden-test", "smartfill-state", "test-account.json"), "utf8"),
);
const SERVER = "https://127.0.0.1:8470";
const PORT = 9339;
const runDir = path.join(ROOT, ".cache", "test-run");
const resultsDir = path.join(HERE, "results");

const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError.message}` : ""}`);
}

async function serverUp() {
  try {
    execFileSync("curl", ["-sk", "--max-time", "2", `${SERVER}/alive`]);
    return true;
  } catch {
    return false;
  }
}

const cleanupOnly = flag("cleanup-only");
if (!cleanupOnly) {
  fs.rmSync(runDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(runDir, "appdata"), { recursive: true });
fs.mkdirSync(path.join(runDir, "chrome-profile"), { recursive: true });
fs.mkdirSync(resultsDir, { recursive: true });
const shot = async (page, name) => {
  const file = path.join(resultsDir, `${name}.png`);
  await page.screenshot({ path: file });
  log("screenshot", path.relative(ROOT, file));
};

/** Names (never secrets) of login-keychain items the app stored for one account. */
function keychainItemsFor(userId) {
  const dump = execFileSync("security", ["dump-keychain"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return dump
    .split(/^keychain: /m)
    .map((item) => ({
      service: /"svce"<blob>="([^"]*)"/.exec(item)?.[1],
      account: /"acct"<blob>="([^"]*)"/.exec(item)?.[1],
    }))
    .filter((it) => it.service === brand.name && it.account?.startsWith(userId))
    .map((it) => it.account);
}

function testUserId() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(runDir, "appdata", "data.json"), "utf8"));
    return data.global_account_activeAccountId ?? Object.keys(data.global_account_accounts ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

async function startApp() {
  log("starting", exe);
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${PORT}`,
      "--ignore-certificate-errors",
      "--use-mock-keychain",
      ...(flag("show") ? [] : ["--autostart"]),
    ],
    {
      env: {
        ...process.env,
        BITWARDEN_APPDATA_DIR: path.join(runDir, "appdata"),
        BITWARDEN_CHROME_PROFILE_DIR: path.join(runDir, "chrome-profile"),
      },
      stdio: [
        "ignore",
        fs.openSync(path.join(runDir, "app-stdout.log"), "a"),
        fs.openSync(path.join(runDir, "app-stderr.log"), "a"),
      ],
    },
  );
  const app = { child, exited: null, browser: null, page: null };
  child.on("exit", (code, signal) => (app.exited = { code, signal }));
  await waitFor(async () => {
    if (app.exited) throw new Error(`app exited early: ${JSON.stringify(app.exited)}`);
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok;
  }, "the DevTools endpoint", 45000);
  app.browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  app.page = await waitFor(
    () => app.browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html")),
    "the app window",
  );
  return app;
}

// Always quits: a test copy with a sign-in screen must not stay open.
async function stopApp(app) {
  if (!app) return;
  try {
    await app.browser?.close();
  } catch {}
  if (!app.exited) {
    app.child.kill("SIGTERM");
    await waitFor(async () => app.exited, "the app to quit", 15000).catch(() => app.child.kill("SIGKILL"));
  }
}

/** From the lock screen: "Log out" and confirm. Taviri then deletes its tokens from the keychain. */
async function logOutFromLockScreen(page, screenshotPrefix) {
  const unlockPassword = page.locator('input[type="password"]').first();
  await unlockPassword.waitFor({ state: "visible", timeout: 45000 });
  await shot(page, `${screenshotPrefix}-locked-after-restart`);
  await page.getByRole("button", { name: /^log out$/i }).first().click();
  const confirm = page.locator("bit-dialog, [role=dialog]").getByRole("button", { name: /^(log out|yes)$/i });
  await confirm.first().click({ timeout: 10000 }).catch(() => {});
}

/**
 * After a logout Bitwarden restarts the renderer on purpose (to wipe it from memory), which the
 * DevTools connection sees as a crashed page: reconnect and wait for the login screen.
 */
async function waitForLoginScreenAfterReload(app, screenshotName) {
  await sleep(2000);
  try {
    await app.browser.close();
  } catch {}
  app.browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  app.page = await waitFor(
    () => app.browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("index.html")),
    "the reloaded app window",
  );
  await app.page
    .locator('input[type="email"], input[formcontrolname="email"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await shot(app.page, screenshotName);
}

if (!flag("login-screen-only") && !cleanupOnly && !(await serverUp())) {
  throw new Error(`test vault not running on ${SERVER} (clients/extension/test/start-test-vault.sh)`);
}

let app;
let ok = false;
try {
  if (cleanupOnly) {
    // Log the test account out of a previous run's data (removes its keychain items).
    const userId = testUserId();
    app = await startApp();
    await logOutFromLockScreen(app.page, "cleanup");
    await waitForLoginScreenAfterReload(app, "cleanup-logged-out");
    await stopApp(app);
    const left = userId ? keychainItemsFor(userId) : [];
    if (left.length) throw new Error(`keychain items left for the test account: ${left.join(", ")}`);
    ok = true;
  } else {
    app = await startApp();
    const page = app.page;
    log("window url:", page.url());

    // 1. Login screen, no server needed.
    const email = page.locator('input[type="email"], input[formcontrolname="email"]').first();
    await email.waitFor({ state: "visible", timeout: 45000 });
    const title = await page.title();
    log("window title:", title);
    await shot(page, "1-login-screen");
    if (title !== brand.name) throw new Error(`window title is "${title}", expected "${brand.name}"`);

    if (flag("login-screen-only")) {
      ok = true;
    } else {
      // 2. Point it at the test vault (self-hosted).
      await page.getByRole("button", { name: /bitwarden\.com|accessing|logging in on/i }).first().click();
      await page.getByRole("menuitem", { name: /self-hosted/i }).first().click();
      const serverUrl = page.locator('input[formcontrolname="baseUrl"]').first();
      await serverUrl.waitFor({ state: "visible", timeout: 15000 });
      await serverUrl.fill(SERVER);
      await shot(page, "2-self-hosted");
      await page.getByRole("button", { name: /^save$/i }).first().click();
      await page.locator("bit-dialog, [role=dialog]").first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});

      // 3. Email, then master password (fake account).
      await email.fill(account.email);
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      const password = page.locator('input[type="password"]').first();
      await password.waitFor({ state: "visible", timeout: 30000 });
      await password.fill(account.password);
      await shot(page, "3-master-password");
      await page.getByRole("button", { name: /^(log in with master password|log in|continue)$/i }).first().click();

      // 4. The vault (synced from the test server).
      await waitFor(async () => /#\/vault/.test(page.url()), "the vault page", 60000);
      await sleep(3000);
      await shot(page, "4-vault");
      const items = await page.locator("[bitrow], cdk-virtual-scroll-viewport [role=row], app-vault-items-v2 a, .virtual-scroll-item").count();
      log("vault page reached; item rows seen:", items);
      const userId = testUserId();
      log("keychain items stored for the test account:", keychainItemsFor(userId).length);

      // 5. Restart: locked; log out, which removes the account's keychain items again.
      await stopApp(app);
      app = await startApp();
      await logOutFromLockScreen(app.page, "5");
      await waitForLoginScreenAfterReload(app, "6-logged-out");
      await stopApp(app);
      const left = keychainItemsFor(userId);
      if (left.length) throw new Error(`keychain items left for the test account: ${left.join(", ")}`);
      log("keychain items left for the test account: 0");
      ok = true;
    }
  }
} finally {
  if (!ok && app?.page) {
    try {
      await shot(app.page, "fail");
    } catch {}
  }
  await stopApp(app);
  log(ok ? "PASS" : "FAIL", `(app data and logs: ${path.relative(ROOT, runDir)})`);
  process.exitCode = ok ? 0 : 1;
}
