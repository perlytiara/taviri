#!/usr/bin/env node
// Browser-bridge test, desktop side: starts the installed Taviri hidden (same isolation as
// login-test.mjs), then runs its desktop_proxy the way Chrome does for the Taviri extension
// (argument = the extension's origin) and checks in the app's log that the proxy reached the
// app's socket and announced that extension. Sends no message, so no dialog can appear.
//
//   node test/bridge-test.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.dirname(HERE);
const brand = JSON.parse(
  fs.readFileSync(path.join(ROOT, "clients", "apps", "browser", "webpack", "smartfill-brand", "brand.json"), "utf8"),
);
const desktopBrand = JSON.parse(
  fs.readFileSync(path.join(ROOT, "clients", "apps", "desktop", "taviri", "brand.json"), "utf8"),
);
const appPath = path.join(os.homedir(), "Applications", `${brand.name}.app`);
const exe = path.join(appPath, "Contents", "MacOS", brand.name);
const proxy = path.join(appPath, "Contents", "MacOS", "desktop_proxy");
const extensionId = desktopBrand.chromeExtensionIds[0];
const runDir = path.join(ROOT, ".cache", "bridge-run");
const PORT = 9340;

const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(path.join(runDir, "appdata"), { recursive: true });
fs.mkdirSync(path.join(runDir, "chrome-profile"), { recursive: true });
const appLog = path.join(runDir, "appdata", "app.log");

log("starting", exe, "(hidden)");
const app = spawn(exe, [`--remote-debugging-port=${PORT}`, "--use-mock-keychain", "--autostart"], {
  env: {
    ...process.env,
    BITWARDEN_APPDATA_DIR: path.join(runDir, "appdata"),
    BITWARDEN_CHROME_PROFILE_DIR: path.join(runDir, "chrome-profile"),
  },
  stdio: "ignore",
});
let appExited = false;
app.on("exit", () => (appExited = true));

let ok = false;
try {
  const started = await waitFor(
    () => fs.existsSync(appLog) && /Native messaging server started at:\s*(\S+)/.exec(fs.readFileSync(appLog, "utf8")),
    "the native messaging server",
    45000,
  );
  log("app socket:", started[1]);
  if (!started[1].includes(desktopBrand.appId)) throw new Error("socket is not in Taviri's own folder");

  log("starting desktop_proxy as Chrome would, for", `chrome-extension://${extensionId}/`);
  const p = spawn(proxy, [`chrome-extension://${extensionId}/`], { stdio: ["pipe", "pipe", "pipe"] });
  let proxyErr = "";
  p.stderr.on("data", (d) => (proxyErr += d));
  const connected = await waitFor(() => {
    const text = fs.readFileSync(appLog, "utf8");
    return text.includes(extensionId) && /client \d+ has connected|connected/i.test(text);
  }, "the app to log the proxy's connection", 15000).catch(() => false);
  p.stdin.end(); // closing stdin is how a browser ends the connection
  await waitFor(() => p.exitCode !== null, "the proxy to exit", 10000).catch(() => p.kill());
  const lines = fs
    .readFileSync(appLog, "utf8")
    .split("\n")
    .filter((l) => /native messaging/i.test(l))
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim());
  lines.forEach((l) => log("app:", l));
  if (proxyErr.trim()) log("proxy stderr:", proxyErr.trim().split("\n").slice(-3).join(" | "));
  if (!connected) throw new Error("the app did not see the proxy connect");
  ok = true;
} finally {
  if (!appExited) {
    app.kill("SIGTERM");
    await waitFor(() => appExited, "the app to quit", 15000).catch(() => app.kill("SIGKILL"));
  }
  log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
}
