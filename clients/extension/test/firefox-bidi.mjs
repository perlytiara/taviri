// A tiny WebDriver BiDi driver for Firefox, with no dependencies (Node's built-in WebSocket).
// Starts a throwaway headless Firefox with its own profile, installs the built Firefox extension as
// a temporary add-on and gives a few helpers to drive pages.
//
// It never starts an installed browser itself: launching /Applications/Firefox Nightly.app a second
// time makes Firefox apply the update the owner's running copy has staged, under that running copy,
// and relaunch the test without --headless. Instead it runs a temporary COPY of the app (its update
// folder is keyed by install path, so the copy has nothing staged), deleted with `removeFirefoxCopy`.
//
// The throwaway profile cannot reach anything but this Mac: every request that is not for
// localhost / *.localhost / 127.0.0.1 goes to a dead proxy. Its certificate checks are off for the
// session (acceptInsecureCerts), so the self-signed test Vaultwarden is accepted.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SOURCE_APP = process.env.SMARTFILL_FIREFOX_APP || "/Applications/Firefox Nightly.app";
const COPY_DIR = path.join(os.tmpdir(), "taviri-firefox-app");

/** Copies the Firefox app to a temporary folder (once) and returns the copy's binary. */
export function firefoxCopy() {
  const copy = path.join(COPY_DIR, path.basename(SOURCE_APP));
  const binary = path.join(copy, "Contents", "MacOS", "firefox");
  const sourceBuild = fs.readFileSync(path.join(SOURCE_APP, "Contents", "Resources", "application.ini"), "utf8").match(/^BuildID=(.*)$/m)?.[1];
  const copyIni = path.join(copy, "Contents", "Resources", "application.ini");
  const copyBuild = fs.existsSync(copyIni) ? fs.readFileSync(copyIni, "utf8").match(/^BuildID=(.*)$/m)?.[1] : null;
  if (copyBuild !== sourceBuild) {
    fs.rmSync(COPY_DIR, { recursive: true, force: true });
    fs.mkdirSync(COPY_DIR, { recursive: true });
    execFileSync("/usr/bin/ditto", ["--noqtn", SOURCE_APP, copy]);
  }
  if (binary.startsWith("/Applications/")) {
    throw new Error("refusing to start an installed browser for tests");
  }
  return binary;
}

export function removeFirefoxCopy() {
  fs.rmSync(COPY_DIR, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function profilePrefs(addonId, uuid) {
  const prefs = {
    "extensions.webextensions.uuids": JSON.stringify({ [addonId]: uuid }),
    "xpinstall.signatures.required": false,
    "extensions.autoDisableScopes": 0,
    "extensions.update.enabled": false,
    "extensions.getAddons.cache.enabled": false,
    "app.update.auto": false,
    "app.update.enabled": false,
    "browser.shell.checkDefaultBrowser": false,
    "browser.startup.page": 0,
    "browser.startup.homepage_override.mstone": "ignore",
    "startup.homepage_welcome_url": "about:blank",
    "browser.aboutwelcome.enabled": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "datareporting.policy.firstRunURL": "",
    "datareporting.healthreport.uploadEnabled": false,
    "toolkit.telemetry.enabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false,
    "browser.newtabpage.enabled": false,
    "browser.safebrowsing.malware.enabled": false,
    "browser.safebrowsing.phishing.enabled": false,
    "network.captive-portal-service.enabled": false,
    "network.connectivity-service.enabled": false,
    "network.dns.disablePrefetch": true,
    "network.prefetch-next": false,
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": 9,
    "network.proxy.ssl": "127.0.0.1",
    "network.proxy.ssl_port": 9,
    "network.proxy.share_proxy_settings": false,
    "network.proxy.no_proxies_on": "localhost, .localhost, 127.0.0.1",
    "signon.rememberSignons": false,
    "dom.disable_open_during_load": false,
  };
  return Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join("\n");
}

export class FirefoxSession {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
  }

  /** Starts Firefox and opens a BiDi session. */
  static async launch({ addonId, port = 9455 }) {
    const session = new FirefoxSession();
    session.addonId = addonId;
    session.uuid = crypto.randomUUID();
    session.profile = fs.mkdtempSync(path.join(os.tmpdir(), "taviri-firefox-test-"));
    fs.writeFileSync(path.join(session.profile, "user.js"), profilePrefs(addonId, session.uuid) + "\n");

    session.process = spawn(
      firefoxCopy(),
      ["--headless", "--no-remote", "--profile", session.profile, "--remote-debugging-port", String(port), "--width", "1200", "--height", "900", "about:blank"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        // System access lets the test open extension pages from the browser's own scope.
        env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: "1", MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
      },
    );
    session.log = "";
    const ready = new Promise((resolve, reject) => {
      const onData = (chunk) => {
        session.log += chunk.toString();
        if (/WebDriver BiDi listening on (ws:\/\/[^\s]+)/.test(session.log)) {
          resolve(session.log.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/)[1]);
        }
      };
      session.process.stdout.on("data", onData);
      session.process.stderr.on("data", onData);
      session.process.on("exit", (code) => reject(new Error(`Firefox exited early (${code}): ${session.log.slice(-500)}`)));
      setTimeout(() => reject(new Error(`Firefox did not start BiDi: ${session.log.slice(-500)}`)), 60000);
    });
    const base = await ready;
    session.socket = new WebSocket(`${base.replace(/\/$/, "")}/session`);
    await new Promise((resolve, reject) => {
      session.socket.onopen = resolve;
      session.socket.onerror = () => reject(new Error("BiDi socket error"));
    });
    session.socket.onmessage = (event) => session.receive(JSON.parse(String(event.data)));
    await session.send("session.new", {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: "ignore" } } },
    });
    return session;
  }

  receive(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.type === "error") {
        reject(new Error(`${message.error}: ${message.message}`));
      } else {
        resolve(message.result);
      }
      return;
    }
    if (message.type === "event") {
      for (const listener of this.listeners) {
        listener(message);
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 60000);
    });
  }

  async installExtension(folder) {
    const result = await this.send("webExtension.install", { extensionData: { type: "path", path: folder } });
    return result.extension;
  }

  extensionUrl(pathname) {
    return `moz-extension://${this.uuid}/${pathname}`;
  }

  /**
   * Opens a URL the page scope may not open (an extension page) in a new tab, from the browser's
   * own scope (needs --remote-allow-system-access), and returns the tab's BiDi context.
   */
  async openPrivilegedTab(url) {
    const before = new Set((await this.topContexts()).map((c) => c.context));
    const { contexts } = await this.send("browsingContext.getTree", { "moz:scope": "chrome" });
    const chromeWindow = contexts[0].context;
    const opened = await this.send("script.callFunction", {
      functionDeclaration: `(url) => {
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        const tab = win.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        win.gBrowser.selectedTab = tab;
        return true;
      }`,
      target: { context: chromeWindow },
      awaitPromise: false,
      arguments: [{ type: "string", value: url }],
    });
    if (opened.type === "exception") {
      throw new Error(opened.exceptionDetails?.text || "could not open the tab");
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      const found = (await this.topContexts()).find((c) => !before.has(c.context));
      if (found) {
        return found.context;
      }
      await sleep(250);
    }
    throw new Error("the new tab did not appear");
  }

  async topContexts() {
    const { contexts } = await this.send("browsingContext.getTree", { maxDepth: 0 });
    return contexts;
  }

  async newContext(type = "tab") {
    const { context } = await this.send("browsingContext.create", { type });
    return context;
  }

  async navigate(context, url, wait = "complete") {
    return this.send("browsingContext.navigate", { context, url, wait });
  }

  async activate(context) {
    return this.send("browsingContext.activate", { context });
  }

  async close(context) {
    return this.send("browsingContext.close", { context }).catch(() => {});
  }

  /** Runs a function in the page and returns its JSON-able result. */
  async call(context, fn, ...args) {
    const result = await this.send("script.callFunction", {
      functionDeclaration: `async (...args) => JSON.stringify(await (${fn.toString()})(...args))`,
      target: { context },
      awaitPromise: true,
      arguments: args.map((value) => ({ type: "string", value: JSON.stringify(value) })),
      serializationOptions: { maxDomDepth: 0 },
    });
    if (result.type === "exception") {
      throw new Error(result.exceptionDetails?.text || "script error");
    }
    return JSON.parse(result.result.value ?? "null");
  }

  /** Like call(), but the arguments arrive as JSON strings to parse (BiDi passes strings). */
  async run(context, fn, ...args) {
    const wrapper = `async (...json) => { const args = json.map((a) => JSON.parse(a)); return (${fn.toString()})(...args); }`;
    return this.call(context, wrapper, ...args);
  }

  async waitFor(context, fn, args = [], timeout = 20000, interval = 250) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.run(context, fn, ...args);
        if (last) {
          return last;
        }
      } catch {
        last = undefined;
      }
      await sleep(interval);
    }
    return last;
  }

  /** A real (trusted) mouse click at page coordinates. */
  async clickAt(context, x, y) {
    await this.send("input.performActions", {
      context,
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", x: Math.round(x), y: Math.round(y) },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await this.send("input.releaseActions", { context }).catch(() => {});
  }

  async quit() {
    try {
      await this.send("browser.close");
    } catch {
      // already gone
    }
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    await new Promise((resolve) => {
      if (this.process.exitCode !== null) {
        resolve();
        return;
      }
      this.process.once("exit", resolve);
      setTimeout(() => {
        this.process.kill("SIGKILL");
        resolve();
      }, 8000);
    });
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}
