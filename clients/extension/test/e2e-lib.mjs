// Shared helpers for the Smartfill end-to-end tests: a fresh, separate Chrome for Testing profile
// with only the built extension loaded, headless (no window on screen).
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { CLIENTS_DIR, EXTENSION_DIR, PROFILE_DIR, VAULT_DIR } from "./paths.mjs";

export { CLIENTS_DIR, EXTENSION_DIR, PROFILE_DIR, VAULT_DIR };

const require = createRequire(import.meta.url);
export const SITE = (host) => `http://${host}.localhost:8471`;
const CHROME_MAJOR = 140;

const { chromium } = require(path.join(CLIENTS_DIR, "node_modules", "playwright"));

export function chromeForTesting() {
  if (process.env.SMARTFILL_CHROME) {
    return process.env.SMARTFILL_CHROME;
  }
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const builds = fs
    .readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const candidate = path.join(
      cache,
      build,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("No Chrome for Testing found in the Playwright cache (npx playwright install chromium).");
}

/** Trust only the test Vaultwarden's self-signed certificate (by its public key hash). */
function vaultSpki() {
  const file = path.join(VAULT_DIR, "tls", "spki.txt");
  return fs.readFileSync(file, "utf8").trim();
}

export async function launchBrowser({ fresh = true } = {}) {
  if (fresh) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: chromeForTesting(),
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [
      "--headless=new",
      // Headless Chrome says "HeadlessChrome", which Bitwarden takes for Safari: use a normal one.
      `--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      `--ignore-certificate-errors-spki-list=${vaultSpki()}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      // Only the local test servers resolve: no request can leave this machine.
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1",
      // Extra switches, for example to try another Chrome: branded Chrome only honours
      // --load-extension with --disable-features=DisableLoadExtensionCommandLineSwitch.
      ...(process.env.SMARTFILL_CHROME_ARGS ? process.env.SMARTFILL_CHROME_ARGS.split(" ") : []),
    ],
  });
  let worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 30000 });
  }
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function siteLog() {
  const response = await fetch("http://127.0.0.1:8471/__log");
  return response.json();
}

export async function resetSiteLog() {
  await fetch("http://127.0.0.1:8471/__reset", { method: "POST" });
}
