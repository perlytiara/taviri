#!/usr/bin/env node
// Local test sites for the Smartfill fork. Fake data only; binds to 127.0.0.1.
// Hosts (Chrome resolves *.localhost to 127.0.0.1):
//   caf.localhost       multi-field login (labels with accents, select, checkbox, aria-labelledby, a tie)
//   impots.localhost    two-step sign-in on one page (fiscal number, then password)
//   bank.localhost      three pages with full page loads: identifier → shuffled image keypad → TOTP
//   game.localhost      game-like screen: shadow DOM, a field that only accepts typed keys, pointer-only button
//   redirect.localhost  a recipe whose click leads to evil.localhost (nothing may be typed there)
//   frame.localhost     a page that embeds game.localhost's sign-in in an iframe
//   plain.localhost     an ordinary username + password form (regular Bitwarden fill)
//   enter.localhost     the same form, for a recipe that ends by pressing Enter
//   broken.localhost    the same form, for a login whose recipe is not valid JSON
// GET /__log on any host returns what the sites received; POST /__reset clears it.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, "pages");
const port = Number(process.env.SMARTFILL_SITE_PORT || 8471);
const bankTotpSecret = process.env.SMARTFILL_BANK_TOTP || "JBSWY3DPEHPK3PXP";

let log = [];
const record = (entry) => {
  log.push({ at: new Date().toISOString(), ...entry });
};

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of secret.toUpperCase().replace(/[\s=-]/g, "")) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret, at = Date.now(), step = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000) + step));
  const h = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(data))));
  });

const html = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

const page = (name) => fs.readFileSync(path.join(pagesDir, name), "utf8");

const shell = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${title}</title><link rel="icon" href="data:,">
<style>body{font:15px system-ui;margin:40px;max-width:560px}label{display:block;margin-top:12px}
input,select,button{font:inherit;padding:6px;margin-top:4px}.keypad{display:grid;grid-template-columns:repeat(5,56px);gap:6px;margin:12px 0}
.keypad button{height:48px}</style></head><body>${body}</body></html>`;

function keyImage(digit) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="12" y="28" font-size="24">${digit}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function bank(req, res, url) {
  if (req.method === "GET" && url.pathname === "/") {
    return html(res, page("bank-identifier.html"));
  }
  if (req.method === "POST" && url.pathname === "/clavier") {
    const body = await readBody(req);
    record({ site: "bank", step: "identifier", identifiant: body.identifiant });
    const digits = [...Array(10).keys()].sort(() => Math.random() - 0.5);
    const keys = digits
      .map((d) => `<button type="button" class="key" data-pos="${d}"><img alt="${d}" src="${keyImage(d)}" width="32" height="32"></button>`)
      .join("");
    return html(
      res,
      shell(
        "Banque Test — code secret",
        `<h1>Code secret</h1><p>Client : <b id="who"></b></p>
<form id="codeForm" action="/otp" method="post">
  <input type="hidden" name="identifiant" id="identifiant">
  <input type="hidden" name="code" id="code">
  <p>Composez votre code : <span id="dots"></span></p>
  <div class="keypad" id="clavier">${keys}</div>
  <button type="button" id="effacer">Effacer</button>
  <button type="submit" id="valider">Valider</button>
</form>
<script>
  const ident = ${JSON.stringify(String(body.identifiant || ""))};
  document.getElementById("identifiant").value = ident;
  document.getElementById("who").textContent = ident;
  const code = document.getElementById("code");
  const dots = document.getElementById("dots");
  const pad = document.getElementById("clavier");
  function reshuffle() {
    const keys = [...pad.children];
    keys.sort(() => Math.random() - 0.5).forEach((k) => pad.append(k));
  }
  pad.addEventListener("click", (event) => {
    const key = event.target.closest(".key");
    if (!key) return;
    code.value += key.querySelector("img").alt;
    dots.textContent = "•".repeat(code.value.length);
    reshuffle();
  });
  document.getElementById("effacer").onclick = () => { code.value = ""; dots.textContent = ""; };
</script>`,
      ),
    );
  }
  if (req.method === "POST" && url.pathname === "/otp") {
    const body = await readBody(req);
    record({ site: "bank", step: "code", identifiant: body.identifiant, code: body.code });
    return html(
      res,
      shell(
        "Banque Test — validation",
        `<h1>Validation</h1><form action="/done" method="post">
<input type="hidden" name="identifiant" value="${String(body.identifiant || "").replace(/"/g, "")}">
<input type="hidden" name="code" value="${String(body.code || "").replace(/"/g, "")}">
<label for="otp">Code de l'application d'authentification</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code">
<button type="submit" id="confirmer">Confirmer</button></form>`,
      ),
    );
  }
  if (req.method === "POST" && url.pathname === "/done") {
    const body = await readBody(req);
    const now = Date.now();
    const validOtp = [-1, 0, 1].some((s) => totp(bankTotpSecret, now, s) === body.otp);
    record({ site: "bank", step: "done", identifiant: body.identifiant, code: body.code, otp: body.otp, otpValid: validOtp });
    return html(res, shell("Banque Test — connecté", `<h1 id="status">Connecté</h1>`));
  }
  return html(res, "not found", 404);
}

async function evil(req, res, url) {
  if (req.method === "POST" && url.pathname === "/collect") {
    const body = await readBody(req);
    record({ site: "evil", step: "captured", ...body });
    return html(res, "ok");
  }
  return html(res, page("evil.html"));
}

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || "").split(":")[0];
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/__log") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify(log));
    }
    if (url.pathname === "/__reset" && req.method === "POST") {
      log = [];
      res.writeHead(204, { "access-control-allow-origin": "*" });
      return res.end();
    }
    if (url.pathname === "/__totp") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: totp(bankTotpSecret) }));
    }
    switch (host) {
      case "caf.localhost":
        if (req.method === "POST") {
          record({ site: "caf", step: "submit", ...(await readBody(req)) });
          return html(res, shell("CAF Test", `<h1 id="status">Envoyé</h1>`));
        }
        return html(res, page("caf.html"));
      case "impots.localhost":
        return html(res, page("impots.html"));
      case "bank.localhost":
        return bank(req, res, url);
      case "game.localhost":
        return html(res, page("game.html"));
      case "redirect.localhost":
        return html(res, page("redirect.html"));
      case "frame.localhost":
        return html(res, page("frame.html"));
      case "plain.localhost":
      case "enter.localhost":
      case "broken.localhost":
        if (req.method === "POST") {
          record({ site: host.split(".")[0], step: "submit", ...(await readBody(req)) });
          return html(res, shell("Test", `<h1 id="status">Signed in</h1>`));
        }
        return html(res, page("simple.html"));
      case "evil.localhost":
        return evil(req, res, url);
      default:
        return html(res, shell("Smartfill test sites", page("index.html")));
    }
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`smartfill test sites on http://*.localhost:${port}/`);
});
