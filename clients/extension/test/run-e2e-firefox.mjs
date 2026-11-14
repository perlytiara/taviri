#!/usr/bin/env node
// End-to-end tests of the Firefox build (`../build/firefox-mv2`) in a throwaway headless copy of
// Firefox Nightly, driven through WebDriver BiDi (see firefox-bidi.mjs). Same fake vault and fake
// sites as run-e2e.mjs; start them first (see README.md).
//
// Fills are started the way the "Fill" button of the popped-out popup starts them (the background's
// unsafeAutofillTabWithCipher), and once through the menu in the field (a real mouse click).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resetSiteLog, SITE, siteLog } from "./e2e-lib.mjs";
import { FirefoxSession, removeFirefoxCopy } from "./firefox-bidi.mjs";
import { testAccount } from "./seed-vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, "results");
const EXTENSION = process.env.SMARTFILL_FIREFOX_EXTENSION_DIR || path.join(here, "..", "build", "firefox-mv2");
const ADDON_ID = "browser-extension@taviri.invalid";
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let s;
let popup;

// --- helpers that run inside pages -------------------------------------------------------------
const clickButton = (text, exact) => {
  const buttons = [...document.querySelectorAll("button, [role=menuitem], a")];
  const button = buttons.find((b) => (exact ? b.textContent.trim() === text : b.textContent.includes(text)));
  if (!button || button.disabled) {
    return false;
  }
  button.click();
  return true;
};
const fillInput = (selector, value) => {
  const input = document.querySelector(selector);
  if (!input) {
    return false;
  }
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};

async function logIn() {
  const account = testAccount();
  popup = await s.openPrivilegedTab(s.extensionUrl("popup/index.html?uilocation=popout#/"));
  const ready = await s.waitFor(popup, () => location.href.startsWith("moz-extension:") && [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Log in"), [], 45000);
  if (!ready) {
    throw new Error("the popup did not show its welcome screen");
  }
  await sleep(1000);
  await s.run(popup, clickButton, "Log in", true);
  await s.waitFor(popup, () => location.hash.startsWith("#/login"), [], 15000);
  await s.waitFor(popup, clickButton, ["bitwarden.com", false], 10000);
  await s.waitFor(popup, clickButton, ["self-hosted", true], 10000);
  await s.waitFor(popup, () => !!document.querySelector("[role=dialog] input, bit-dialog input"), [], 10000);
  await s.run(popup, fillInput, "[role=dialog] input, bit-dialog input", account.server);
  // The dialog can re-render right after the URL is typed: retry until its Save button is clicked.
  await s.waitFor(
    popup,
    () => {
      const dialog = document.querySelector("[role=dialog], bit-dialog");
      const save = dialog && [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save");
      save?.click();
      return !!save;
    },
    [],
    10000,
  );
  await s.waitFor(popup, () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("self-hosted")), [], 10000);
  await s.run(popup, fillInput, "input[type=email], input[formcontrolname=email]", account.email);
  await s.waitFor(popup, clickButton, ["Continue", true], 10000);
  await s.waitFor(popup, () => !!document.querySelector("input[type=password]"), [], 20000);
  await s.run(popup, fillInput, "input[type=password]", account.password);
  await s.waitFor(popup, clickButton, ["Log in", true], 10000);
  const unlocked = await s.waitFor(popup, () => /#\/(tabs\/vault|vault|tabs)/.test(location.hash), [], 90000, 500);
  if (!unlocked) {
    throw new Error(`login did not reach the vault (popup at ${await s.run(popup, () => location.hash)})`);
  }
  await sleep(4000);
}

/** What the popped-out popup's Fill button does: fill the site's tab with the login saved for it. */
async function fillFromPopup(siteUrl) {
  return s.run(
    popup,
    async (site) => {
      const main = browser.extension.getBackgroundPage().bitwardenMain;
      const tabs = await browser.tabs.query({});
      const tab = tabs.find((t) => (t.url || "").startsWith(site));
      if (!tab) {
        return { error: "no tab for the site" };
      }
      const userId = await main.autofillOrchestrator.activeUserId();
      const [cipher] = await main.cipherService.getAllDecryptedForUrl(tab.url, userId);
      if (!cipher) {
        return { error: "no login for the site" };
      }
      const result = await main.autofillOrchestrator.unsafeAutofillTabWithCipher(tab, cipher);
      return { login: cipher.name, outcome: result?.outcome };
    },
    siteUrl,
  );
}

async function openSite(host, pathname = "/") {
  const context = await s.newContext("tab");
  await s.navigate(context, SITE(host) + pathname);
  await s.activate(context);
  await sleep(2500);
  return context;
}

const value = (context, selector) => s.run(context, (sel) => document.querySelector(sel)?.value ?? null, selector);

async function scenario(id, title, run) {
  if (only.length && !only.includes(id)) {
    return;
  }
  const started = Date.now();
  const entry = { id, title, pass: false, checks: [], ms: 0 };
  const check = (name, pass, detail) => {
    entry.checks.push({ name, pass: !!pass, ...(detail !== undefined ? { detail } : {}) });
    return !!pass;
  };
  let context;
  try {
    await resetSiteLog();
    context = await run(check);
    entry.pass = entry.checks.length > 0 && entry.checks.every((c) => c.pass);
  } catch (error) {
    entry.error = String(error?.message ?? error).slice(0, 400);
  }
  entry.ms = Date.now() - started;
  if (context) {
    await s.close(context);
  }
  results.push(entry);
  console.log(`${entry.pass ? "PASS" : "FAIL"}  ${id}  ${title}  (${entry.ms} ms)`);
  for (const c of entry.checks.filter((c) => !c.pass)) {
    console.log(`      ✗ ${c.name}${c.detail !== undefined ? `: ${JSON.stringify(c.detail)}` : ""}`);
  }
  if (entry.error) {
    console.log(`      error: ${entry.error}`);
  }
}

async function main() {
  fs.mkdirSync(resultsDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, "manifest.json"), "utf8"));
  s = await FirefoxSession.launch({ addonId: ADDON_ID });
  const browserInfo = s.log.match(/Mozilla Firefox [^\s]+|Firefox Nightly [^\s]+/)?.[0];
  await s.installExtension(EXTENSION);
  const version = await (async () => {
    const tree = await s.topContexts();
    return s.run(tree[0].context, () => navigator.userAgent.match(/Firefox\/[\d.a]+/)?.[0]);
  })();
  console.log(`extension ${manifest.name} ${manifest.version} (Manifest V${manifest.manifest_version}) in ${version} (headless copy of Firefox Nightly)`);
  // The scripted login is timing-sensitive in headless Firefox: one more try from a fresh tab.
  try {
    await logIn();
  } catch (error) {
    console.log(`login retry after: ${error.message}`);
    await s.close(popup);
    await logIn();
  }
  console.log("logged in to the local test vault");

  await scenario("plain", "Ordinary username + password form still fills", async (check) => {
    const page = await openSite("plain");
    const outcome = await fillFromPopup(SITE("plain"));
    await s.waitFor(page, (sel) => !!document.querySelector(sel)?.value, ["#password"], 10000);
    check("fill accepted", outcome.outcome === "filled", outcome);
    check("username", (await value(page, "#user")) === "plain-user", await value(page, "#user"));
    check("password", (await value(page, "#password")) === "Plain-pass-1");
    return page;
  });

  await scenario("multifield", "Multi-field login: custom fields matched to labels (accents, select, checkbox, aria-labelledby, tie)", async (check) => {
    const page = await openSite("caf");
    await fillFromPopup(SITE("caf"));
    await s.waitFor(page, () => !!document.querySelector("#cid")?.value && !!document.querySelector("#code")?.value, [], 10000);
    await sleep(500);
    check('"Numero allocataire" → label "Numéro allocataire *"', (await value(page, "#num")) === "1234567", await value(page, "#num"));
    check("password → Code confidentiel", (await value(page, "#code")) === "246810");
    check('"Date de naissance" (hidden field) → placeholder', (await value(page, "#dob")) === "01/02/1990", await value(page, "#dob"));
    check('"Pays" = france → option France', (await value(page, "#pays")) === "FR", await value(page, "#pays"));
    check('"Se souvenir de moi" (boolean) → checkbox', await s.run(page, () => document.querySelector("#remember").checked));
    check('"Identifiant client" → aria-labelledby', (await value(page, "#cid")) === "CL-998877", await value(page, "#cid"));
    check('"Code" matches two boxes equally → neither filled', (await value(page, "#c1")) === "" && (await value(page, "#c2")) === "");
    return page;
  });

  await scenario("inline-menu", "Multi-field login through the menu in the field (real mouse clicks)", async (check) => {
    const page = await openSite("caf");
    const box = await s.run(page, () => {
      const r = document.querySelector("#code").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await s.clickAt(page, box.x + 20, box.y + box.height / 2);
    // The menu is the extension's own frame inside the page.
    let menu = null;
    for (let i = 0; i < 40 && !menu; i++) {
      const { contexts } = await s.send("browsingContext.getTree", { root: page });
      const frames = [];
      const walk = (list) => list.forEach((c) => { frames.push(c.url); walk(c.children || []); });
      walk(contexts);
      menu = frames.find((url) => /overlay\/menu-list\.html/.test(url)) ?? null;
      if (!menu) {
        await sleep(250);
      }
    }
    check("menu opened", !!menu);
    await sleep(800);
    await s.clickAt(page, box.x + 90, box.y + box.height + 30);
    await s.waitFor(page, () => !!document.querySelector("#cid")?.value, [], 10000);
    check("extra field filled", (await value(page, "#num")) === "1234567", await value(page, "#num"));
    check("password filled", (await value(page, "#code")) === "246810");
    return page;
  });

  await scenario("two-step", "Recipe: fiscal number, Continue, wait for the password box, password, Connexion (one page)", async (check) => {
    const page = await openSite("impots");
    await fillFromPopup(SITE("impots"));
    const raw = await s.waitFor(page, () => document.body.dataset.result, [], 20000);
    const result = raw ? JSON.parse(raw) : {};
    check("fiscal number typed (field:Numéro fiscal)", result.spi === "1234567890123", result.spi);
    check("password typed after the box appeared", result.password === "Imp0ts-Test!");
    return page;
  });

  await scenario("bank", "Recipe across page loads: identifier, shuffled image keypad (reshuffles after each press), TOTP", async (check) => {
    const page = await openSite("bank");
    await fillFromPopup(SITE("bank"));
    let done;
    for (let i = 0; i < 180 && !done; i++) {
      done = (await siteLog()).find((e) => e.site === "bank" && e.step === "done");
      if (!done) {
        await sleep(250);
      }
    }
    const log = await siteLog();
    check("identifier typed on page 1", log.find((e) => e.step === "identifier")?.identifiant === "client-4242");
    check("code entered on the shuffled keypad (page 2)", log.find((e) => e.step === "code")?.code === "73519", log.find((e) => e.step === "code")?.code);
    check("TOTP code accepted (page 3)", done?.otpValid === true, done ? "wrong code" : "no code");
    return page;
  });

  await scenario("game", "Recipe on a game-like screen: shadow DOM, a field that only accepts typed keys, a pointer-only button", async (check) => {
    const page = await openSite("game");
    await fillFromPopup(SITE("game"));
    const raw = await s.waitFor(page, () => document.body.dataset.result, [], 20000);
    const result = raw ? JSON.parse(raw) : {};
    check("pilot name typed inside the shadow root", result.pilot === "AcePilot", result.pilot);
    check("passcode typed key by key", result.passcode === "Zz9-launch");
    return page;
  });

  await scenario("leaves-site", "Safety: a recipe whose click leads to another site types nothing there", async (check) => {
    const page = await openSite("redirect");
    await fillFromPopup(SITE("redirect"));
    const moved = await s.waitFor(page, () => location.host.startsWith("evil.localhost"), [], 15000);
    check("the click led to the other site", !!moved);
    await sleep(7000);
    check("nothing typed on the other site", (await value(page, "#password")) === "");
    check("the other site received nothing", !(await siteLog()).some((e) => e.site === "evil"));
    return page;
  });

  await scenario("broken-recipe", "A recipe that is not valid JSON: a notice, nothing typed", async (check) => {
    const page = await openSite("broken");
    await fillFromPopup(SITE("broken"));
    const notice = await s.waitFor(page, () => !!document.querySelector("bitwarden-smartfill-notice"), [], 10000);
    check("notice shown", !!notice);
    check("nothing typed", (await value(page, "#user")) === "" && (await value(page, "#password")) === "");
    return page;
  });

  await scenario("item-icons", "Taviri item icons: a taviri:icon field picks a pack icon, other items get their type's icon", async (check) => {
    const packImage = (id) =>
      `data:image/png;base64,${fs.readFileSync(path.join(here, "..", "brand", "item-icons", "png", `${id}.png`)).toString("base64")}`;
    await s.activate(popup).catch(() => {});
    await s.run(popup, () => {
      location.hash = "#/tabs/vault";
      return true;
    });
    // The vault list is virtual (only the rows in view are drawn), so each item is looked up with
    // the vault's own search, then its icon is read.
    const searchBox = "input[type=search], bit-search input";
    await s.waitFor(popup, (selector) => !!document.querySelector(selector), [searchBox], 20000);
    const iconOf = async (name) => {
      await s.run(popup, fillInput, searchBox, name);
      return s.waitFor(
        popup,
        (wanted) => {
          const rows = [...document.querySelectorAll("app-vault-icon")].filter((icon) =>
            (icon.closest("bit-item")?.textContent ?? "").includes(wanted),
          );
          // A login can be listed twice (suggested for the current tab, and under all items).
          // Read the picture the extension chose: headless Firefox may leave a lazy image of a
          // tab that is not on screen unloaded (hidden) for a long time.
          const imgs = rows.flatMap((row) => [...row.querySelectorAll("img")]);
          const chosen = imgs.find((i) => !i.classList.contains("tw-invisible")) ?? imgs[0];
          return chosen ? chosen.getAttribute("src") : null;
        },
        [name],
        15000,
      );
    };
    for (const [name, id, what] of [
      ["Home Wi-Fi (test)", "wifi", "field taviri:icon = wifi"],
      ["Relay dev (test)", "relay", "field taviri:icon = relay (the app family's Relay icon)"],
      ["Server notes (test)", "note", "a note without the field: the note icon"],
      ["App only (test)", "phone", "an app-only login: the phone icon"],
      ["Test card (test)", "card", "a card: the card icon"],
    ]) {
      const src = await iconOf(name);
      const detail =
        src?.slice(0, 40) ??
        (await s.run(
          popup,
          (wanted) => ({
            search: document.querySelector("input[type=search], bit-search input")?.value,
            rows: [...document.querySelectorAll("app-vault-icon")]
              .filter((icon) => (icon.closest("bit-item")?.textContent ?? "").includes(wanted))
              .map((icon) => ({
                section: icon.closest("app-vault-list-items-container, section")?.querySelector("h2, h3, [bitTypography]")?.textContent?.trim()?.slice(0, 30),
                top: Math.round(icon.getBoundingClientRect().top),
                imgs: [...icon.querySelectorAll("img")].map((i) => `${i.className}|${(i.getAttribute("src") ?? "").slice(0, 26)}|complete=${i.complete}|w=${i.naturalWidth}`),
                font: icon.querySelector("i")?.className ?? null,
              })),
            total: document.querySelectorAll("app-vault-icon").length,
          }),
          name,
        ));
      check(`${name}: ${what}`, src === packImage(id), detail);
    }
    await s.run(popup, fillInput, searchBox, "");
    // The popup stays open for later runs: nothing to close.
    return undefined;
  });

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    date: new Date().toISOString(),
    extension: { name: manifest.name, version: manifest.version, manifest_version: manifest.manifest_version },
    browser: `${version} (headless temporary copy of Firefox Nightly, separate profile), via WebDriver BiDi`,
    vault: "local Vaultwarden, fake account and fake logins",
    passed,
    total: results.length,
    results,
  };
  fs.writeFileSync(path.join(resultsDir, "e2e-firefox-results.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(
    path.join(resultsDir, "e2e-firefox-results.md"),
    [
      "# End-to-end results: Firefox",
      "",
      `- Date: ${summary.date}`,
      `- Extension: ${manifest.name} ${manifest.version} (Manifest V${manifest.manifest_version}), installed as a temporary add-on`,
      `- Browser: ${summary.browser}`,
      `- Vault: ${summary.vault}`,
      `- Result: **${passed} of ${results.length} scenarios passed**`,
      "",
      "| Scenario | Result | Checks |",
      "|---|---|---|",
      ...results.map(
        (r) =>
          `| ${r.title} | ${r.pass ? "pass" : "FAIL"} | ${r.checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.name}`).join("<br>")}${r.error ? `<br>error: ${r.error}` : ""} |`,
      ),
      "",
    ].join("\n"),
  );
  console.log(`\n${passed} of ${results.length} scenarios passed`);
  return passed === results.length ? 0 : 1;
}

let code = 2;
try {
  code = await main();
} catch (error) {
  console.error(error);
} finally {
  await s?.quit().catch(() => {});
  if (!process.argv.includes("--keep-copy")) {
    removeFirefoxCopy();
  }
}
process.exit(code);
