#!/usr/bin/env node
// End-to-end tests of the Smartfill fork: the built extension, loaded unpacked in a separate
// headless Chrome for Testing profile, logged in to the LOCAL fake vault, filling local fake sites.
//
//   1. test/start-test-vault.sh          (throwaway Vaultwarden, https://127.0.0.1:8470)
//   2. node test/site-server.mjs         (fake sites, http://*.localhost:8471)
//   3. NODE_EXTRA_CA_CERTS=~/vaultwarden-test/tls/cert.pem node test/seed-vault.mjs
//   4. node test/run-e2e.mjs
//
// A fill is started the way the keyboard shortcut starts it (the same orchestrator call the
// "autofill_login" command makes), and once through the inline menu.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTENSION_DIR,
  launchBrowser,
  PROFILE_DIR,
  resetSiteLog,
  SITE,
  siteLog,
  sleep,
} from "./e2e-lib.mjs";
import { testAccount } from "./seed-vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, "results");
const results = [];
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const verbose = process.argv.includes("--verbose");

let context;
let extensionId;

function liveWorker() {
  const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    throw new Error("the extension's service worker is not running");
  }
  return worker;
}

async function logIn() {
  const account = testAccount();
  const page = await context.newPage();
  await page.setViewportSize({ width: 380, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/popup/index.html?uilocation=popout#/`);
  await page.getByRole("button", { name: "Log in" }).waitFor({ timeout: 45000 });
  await sleep(1000);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/#\/login/, { timeout: 15000 });

  await page.getByRole("button", { name: "bitwarden.com" }).click();
  await page.getByRole("menuitem", { name: "self-hosted" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Server URL" }).fill(account.server);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "self-hosted" }).waitFor({ timeout: 10000 });

  await page.getByRole("textbox", { name: /Email address/ }).fill(account.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: /Master password/ }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/#\/(tabs\/vault|vault|tabs)/, { timeout: 60000 });
  await sleep(4000);
  return page;
}

async function vaultStatus() {
  return liveWorker().evaluate(async () => {
    const main = self.bitwardenMain;
    const { firstValueFrom } = { firstValueFrom: (o) => new Promise((resolve) => { const s = o.subscribe((v) => { resolve(v); setTimeout(() => s.unsubscribe()); }); }) };
    const status = await firstValueFrom(main.authService.activeAccountStatus$);
    return { status };
  });
}

/** Starts a fill of the active tab exactly as the keyboard shortcut does. */
async function fillActiveTab() {
  return liveWorker().evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    self.bitwardenMain.autofillOrchestrator.autofillActiveTabFromCommand(tab);
    return tab?.url;
  });
}

async function openSite(host, pathname = "/") {
  const page = await context.newPage();
  page.consoleLines = [];
  page.on("console", (m) => {
    page.consoleLines.push(m.text());
    if (verbose) {
      console.log(`   [${host}] ${m.type()} ${m.text().slice(0, 200)}`);
    }
  });
  await page.goto(SITE(host) + pathname);
  await page.bringToFront();
  // Give the autofill content script time to start monitoring the page.
  await sleep(2000);
  return page;
}

async function waitFor(check, timeout = 20000, interval = 200) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) {
        return last;
      }
    } catch (error) {
      last = undefined;
    }
    await sleep(interval);
  }
  return last;
}

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
  let page;
  try {
    await resetSiteLog();
    page = await run(check);
    entry.pass = entry.checks.length > 0 && entry.checks.every((c) => c.pass);
  } catch (error) {
    entry.error = String(error?.message ?? error).slice(0, 400);
  }
  entry.ms = Date.now() - started;
  if (page && !entry.pass) {
    await page.screenshot({ path: path.join(resultsDir, `${id}-failed.png`) }).catch(() => {});
  }
  if (page) {
    await page.close().catch(() => {});
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

const value = (page, selector) => page.locator(selector).inputValue();

async function main() {
  fs.mkdirSync(resultsDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  ({ context, extensionId } = await launchBrowser());
  console.log(`extension ${manifest.name} ${manifest.version} (${extensionId}), separate test profile`);

  const popup = await logIn();
  console.log(`logged in to the local test vault (${(await vaultStatus()).status === 2 ? "unlocked" : "not unlocked"})`);
  await popup.close();

  await scenario("plain", "Ordinary username + password form still fills (regular Bitwarden fill)", async (check) => {
    const page = await openSite("plain");
    await fillActiveTab();
    await waitFor(async () => (await value(page, "#password")) !== "");
    check("username", (await value(page, "#user")) === "plain-user", await value(page, "#user"));
    check("password", (await value(page, "#password")) === "Plain-pass-1");
    check("no notice", (await page.locator("bitwarden-smartfill-notice").count()) === 0);
    return page;
  });

  await scenario("multifield", "Multi-field login: custom fields matched to labels (accents, select, checkbox, aria-labelledby, tie)", async (check) => {
    const page = await openSite("caf");
    await fillActiveTab();
    await waitFor(async () => (await value(page, "#cid")) !== "" && (await value(page, "#code")) !== "");
    await sleep(500);
    check('"Numero allocataire" → label "Numéro allocataire *"', (await value(page, "#num")) === "1234567", await value(page, "#num"));
    check("password → Code confidentiel", (await value(page, "#code")) === "246810");
    check('"Date de naissance" (hidden field) → placeholder', (await value(page, "#dob")) === "01/02/1990", await value(page, "#dob"));
    check('"Pays" = france → option France', (await value(page, "#pays")) === "FR", await value(page, "#pays"));
    check('"Se souvenir de moi" (boolean) → checkbox', await page.locator("#remember").isChecked());
    check('"Identifiant client" → aria-labelledby', (await value(page, "#cid")) === "CL-998877", await value(page, "#cid"));
    check('"Code" matches two boxes equally → neither filled', (await value(page, "#c1")) === "" && (await value(page, "#c2")) === "", [await value(page, "#c1"), await value(page, "#c2")]);
    return page;
  });

  await scenario("inline-menu", "Multi-field login through the inline menu (click the login in the dropdown)", async (check) => {
    const page = await openSite("caf");
    await page.locator("#code").click();
    const menu = await waitFor(() => page.frames().find((f) => /overlay\/menu-list\.html/.test(f.url())), 10000);
    if (!check("inline menu opened", !!menu)) {
      return page;
    }
    // The menu's rows sit in closed shadow roots, so click where a person would: the first row,
    // just below the field. (A real, trusted mouse click.)
    await sleep(1500);
    const box = await page.locator("#code").boundingBox();
    await page.mouse.click(box.x + 90, box.y + box.height + 30);
    await waitFor(async () => (await value(page, "#cid")) !== "");
    await sleep(500);
    check("extra field filled", (await value(page, "#num")) === "1234567", await value(page, "#num"));
    check("password filled", (await value(page, "#code")) === "246810");
    check("aria-labelledby field filled", (await value(page, "#cid")) === "CL-998877");
    return page;
  });

  await scenario("two-step", "Recipe: fiscal number, Continue, wait for the password box, password, Connexion (one page)", async (check) => {
    const page = await openSite("impots");
    await fillActiveTab();
    const raw = await waitFor(() => page.evaluate(() => document.body.dataset.result), 20000);
    const result = raw ? JSON.parse(raw) : {};
    check("fiscal number typed (field:Numéro fiscal)", result.spi === "1234567890123", result.spi);
    check("password typed after the box appeared", result.password === "Imp0ts-Test!");
    check("no notice", (await page.locator("bitwarden-smartfill-notice").count()) === 0);
    return page;
  });

  await scenario("bank", "Recipe across page loads: identifier, shuffled image keypad (reshuffles after each press), TOTP", async (check) => {
    const page = await openSite("bank");
    await fillActiveTab();
    const done = await waitFor(async () => (await siteLog()).find((e) => e.site === "bank" && e.step === "done"), 45000);
    const log = await siteLog();
    check("identifier typed on page 1", log.find((e) => e.step === "identifier")?.identifiant === "client-4242", log.find((e) => e.step === "identifier")?.identifiant);
    check("code entered on the shuffled keypad (page 2)", log.find((e) => e.step === "code")?.code === "73519", log.find((e) => e.step === "code")?.code);
    check("TOTP code accepted (page 3)", done?.otpValid === true, done?.otp ? "wrong code" : "no code");
    check("signed in", /\/done$/.test(page.url()), page.url());
    return page;
  });

  await scenario("game", "Recipe on a game-like screen: shadow DOM, a field that only accepts typed keys, a pointer-only button", async (check) => {
    const page = await openSite("game");
    await fillActiveTab();
    const raw = await waitFor(() => page.evaluate(() => document.body.dataset.result), 20000);
    const result = raw ? JSON.parse(raw) : {};
    check("pilot name typed inside the shadow root", result.pilot === "AcePilot", result.pilot);
    check("passcode typed key by key", result.passcode === "Zz9-launch");
    return page;
  });

  await scenario("popup-fill-in-frame", "Recipe started like the popup's Fill button, running inside an iframe on the login's site", async (check) => {
    const page = await openSite("frame");
    const frame = await waitFor(() => page.frames().find((f) => /game\.localhost/.test(f.url())), 10000);
    if (!check("the sign-in frame loaded", !!frame)) {
      return page;
    }
    await sleep(1500);
    // What the popup does when you click Fill on a login: fill this tab with that login.
    const outcome = await liveWorker().evaluate(async (siteUrl) => {
      const main = self.bitwardenMain;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const userId = await main.autofillOrchestrator.activeUserId();
      const [cipher] = await main.cipherService.getAllDecryptedForUrl(siteUrl, userId);
      const result = await main.autofillOrchestrator.autofillTabWithCipher(tab, cipher);
      return { login: cipher?.name, outcome: result?.outcome };
    }, SITE("game"));
    check("the fill was accepted", outcome.login === "Game (test)" && outcome.outcome === "filled", outcome);
    const raw = await waitFor(() => frame.evaluate(() => document.body.dataset.result), 20000);
    const result = raw ? JSON.parse(raw) : {};
    check("the steps ran inside the frame", result.pilot === "AcePilot" && result.passcode === "Zz9-launch", result.pilot);
    return page;
  });

  await scenario("leaves-site", "Safety: a recipe whose click leads to another site types nothing there", async (check) => {
    const page = await openSite("redirect");
    await fillActiveTab();
    await waitFor(() => /evil\.localhost/.test(page.url()), 15000);
    check("the click led to the other site", /evil\.localhost/.test(page.url()), page.url());
    await sleep(7000);
    check("nothing typed on the other site", (await value(page, "#password")) === "", "field not empty");
    check("the other site received nothing", !(await siteLog()).some((e) => e.site === "evil"));
    return page;
  });

  await scenario("press-enter", "Recipe: fill, skip an optional step, press Enter to submit the form", async (check) => {
    const page = await openSite("enter");
    await fillActiveTab();
    const submitted = await waitFor(async () => (await siteLog()).find((e) => e.site === "enter"), 15000);
    check("form submitted by Enter", !!submitted);
    check("username sent", submitted?.username === "enter-user", submitted?.username);
    check("password sent", submitted?.password === "Enter-pass-1");
    return page;
  });

  await scenario("page-load", "A page-load fill request fills an ordinary login but never runs a recipe", async (check) => {
    // Headless Chrome never reports window focus changes, so Bitwarden's tab tracker never calls
    // the tab "in use" and holds back real page-load fills. Hand the orchestrator the same
    // page-load request it would get from "autofill on page load".
    const pageLoadFill = () =>
      liveWorker().evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        self.bitwardenMain.autofillOrchestrator.fillRequest$.next({
          kind: "pageLoad",
          tab,
          tabId: tab.id,
          frameId: 0,
          frameUrl: tab.url,
        });
      });

    // Turn the feature on as its settings page does: the switch and the per-login default.
    const setPageLoad = (on) =>
      liveWorker().evaluate(async (value) => {
        const settings = self.bitwardenMain.autofillSettingsService;
        await settings.setAutofillOnPageLoad(value);
        await settings.setAutofillOnPageLoadDefault(value);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }, on);

    await setPageLoad(true);
    let page;
    try {
      const plain = await openSite("plain");
      await pageLoadFill();
      await waitFor(async () => (await value(plain, "#password")) !== "", 10000);
      check("the ordinary login is filled by a page-load request", (await value(plain, "#password")) === "Plain-pass-1");
      await plain.close();

      page = await openSite("impots");
      const selected = await liveWorker().evaluate(async () => {
        const main = self.bitwardenMain;
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const userId = await main.autofillOrchestrator.activeUserId();
        return (await main.cipherService.getLastUsedForUrl(tab.url, userId, true))?.name;
      });
      check("a page-load fill does pick that login", selected === "Impots (test)", selected);
      await pageLoadFill();
      await sleep(6000);
      check("the login with a recipe is left alone", (await value(page, "#spi_tmp")) === "", await value(page, "#spi_tmp"));
      check("its steps did not run", !(await page.evaluate(() => document.body.dataset.result)));
      check("no notice", (await page.locator("bitwarden-smartfill-notice").count()) === 0);
    } finally {
      await setPageLoad(false);
    }
    return page;
  });

  await scenario("broken-recipe", "A recipe that is not valid JSON: a notice, nothing typed", async (check) => {
    const page = await openSite("broken");
    await fillActiveTab();
    const notice = await waitFor(async () => (await page.locator("bitwarden-smartfill-notice").count()) > 0, 10000);
    check("notice shown", !!notice);
    check("nothing typed", (await value(page, "#user")) === "" && (await value(page, "#password")) === "");
    // The same text goes to the page's console, under the build's own name.
    const logged = page.consoleLines.find((line) => line.includes("can't be used"));
    check(`the notice goes by the build's name (${manifest.name})`, !!logged && logged.startsWith(`[${manifest.name}]`), logged?.slice(0, 60));
    check("the notice names the login's recipe field", !!logged && logged.includes('("grokbot:recipe")'), logged?.slice(0, 120));
    return page;
  });

  await scenario("item-icons", "Taviri item icons: a taviri:icon field picks a pack icon, other items get their type's icon", async (check) => {
    const packImage = (id) =>
      `data:image/png;base64,${fs.readFileSync(path.join(here, "..", "brand", "item-icons", "png", `${id}.png`)).toString("base64")}`;
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 1600 });
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html?uilocation=popout#/tabs/vault`);
    const rowsOf = () =>
      popup.evaluate(() =>
        [...document.querySelectorAll("app-vault-icon")].map((icon) => {
          const row = icon.closest("bit-item, li, a, button") ?? icon.parentElement;
          const imgs = [...icon.querySelectorAll("img")];
          const shown = imgs.find((i) => !i.classList.contains("tw-invisible")) ?? null;
          return {
            text: (row?.innerText ?? "").split("\n")[0].trim(),
            src: shown?.getAttribute("src") ?? null,
            all: imgs.map((i) => i.getAttribute("src")),
          };
        }),
      );
    const rows = await waitFor(async () => {
      const found = await rowsOf();
      return found.some((r) => r.text.startsWith("Home Wi-Fi")) && found.some((r) => r.text.startsWith("Test identity")) ? found : null;
    }, 30000);
    const iconOf = (name) => (rows ?? []).find((r) => r.text.startsWith(name))?.src ?? null;
    const expect = [
      ["Home Wi-Fi (test)", "wifi", "field taviri:icon = wifi"],
      ["Recovery codes (test)", "codes", "field taviri:icon = codes"],
      ["Relay dev (test)", "relay", "field taviri:icon = relay (the app family's Relay icon)"],
      ["Server notes (test)", "note", "a note without the field: the note icon"],
      ["App only (test)", "phone", "an app-only login: the phone icon"],
      ["No website (test)", "user", "a login without a website: the account icon"],
      ["Test card (test)", "card", "a card: the card icon"],
      ["Test identity (test)", "identity", "an identity: the identity icon"],
    ];
    for (const [name, id, what] of expect) {
      check(`${name}: ${what}`, iconOf(name) === packImage(id), iconOf(name)?.slice(0, 40));
    }
    const plain = (rows ?? []).find((r) => r.text.startsWith("Plain (test)"));
    check(
      "a login with a website still asks the vault's icon service for the site's icon",
      !!plain?.all.some((src) => src?.includes("/icons/plain.localhost/icon.png")),
      plain?.all.map((src) => src?.slice(0, 60)),
    );
    check(
      "…and shows it, or the globe tile while it loads or when the site has none",
      !!plain?.src && (plain.src.includes("/icons/plain.localhost/") || plain.src === packImage("globe")),
      plain?.src?.slice(0, 60),
    );
    await popup.screenshot({ path: path.join(resultsDir, "screens", "8-item-icons.png"), clip: { x: 0, y: 0, width: 380, height: 1100 } }).catch(() => {});
    return popup;
  });

  await context.close();
  // The profile only holds the fake login; a fresh one is made on every run.
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    date: new Date().toISOString(),
    extension: { name: manifest.name, version: manifest.version, manifest_version: manifest.manifest_version },
    browser: "Chrome for Testing (headless), separate profile",
    vault: "local Vaultwarden, fake account and fake logins",
    passed,
    total: results.length,
    results,
  };
  fs.writeFileSync(path.join(resultsDir, "e2e-results.json"), JSON.stringify(summary, null, 2) + "\n");
  const lines = [
    "# End-to-end results",
    "",
    `- Date: ${summary.date}`,
    `- Extension: ${manifest.name} ${manifest.version} (Manifest V${manifest.manifest_version}), loaded unpacked`,
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
  ];
  fs.writeFileSync(path.join(resultsDir, "e2e-results.md"), lines.join("\n"));
  console.log(`\n${passed} of ${results.length} scenarios passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await context?.close().catch(() => {});
  process.exit(2);
});
