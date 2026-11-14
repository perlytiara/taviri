#!/usr/bin/env node
// Screenshots of the branded extension (fake vault, fake sites), for a visual check of the
// rebrand: popup welcome / login / vault (light and dark), the menu in a field and the save bar.
// Writes test/results/screens/*.png. Start the test vault and sites first (README.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser, SITE, sleep } from "./e2e-lib.mjs";
import { testAccount } from "./seed-vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "results", "screens");
fs.mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const { context, extensionId } = await launchBrowser();
const popupUrl = `chrome-extension://${extensionId}/popup/index.html?uilocation=popout#/`;
try {
  const account = testAccount();
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "Log in" }).waitFor({ timeout: 45000 });
  await sleep(1200);
  await shot(popup, "1-welcome");

  await popup.getByRole("button", { name: "Log in" }).click();
  await popup.waitForURL(/#\/login/);
  await popup.getByRole("button", { name: "bitwarden.com" }).click();
  await popup.getByRole("menuitem", { name: "self-hosted" }).click();
  await popup.getByRole("dialog").getByRole("textbox", { name: "Server URL" }).fill(account.server);
  await popup.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await popup.getByRole("button", { name: "self-hosted" }).waitFor();
  await sleep(800);
  await shot(popup, "2-login");
  await popup.getByRole("textbox", { name: /Email address/ }).fill(account.email);
  await popup.getByRole("button", { name: "Continue" }).click();
  await popup.getByRole("textbox", { name: /Master password/ }).fill(account.password);
  await popup.getByRole("button", { name: "Log in", exact: true }).click();
  await popup.waitForURL(/#\/(tabs\/vault|vault|tabs)/, { timeout: 60000 });
  await sleep(4000);
  await shot(popup, "3-vault-light");
  await popup.emulateMedia({ colorScheme: "dark" });
  await sleep(1500);
  await shot(popup, "4-vault-dark");
  await popup.emulateMedia({ colorScheme: "light" });
  await popup.goto(popupUrl.replace("#/", "#/tabs/settings"));
  await sleep(2500);
  await shot(popup, "5-settings");
  await popup.close();

  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto(SITE("caf") + "/");
  await page.bringToFront();
  await sleep(2500);
  await page.locator("#code").click();
  await sleep(2500);
  await shot(page, "6-field-menu");

  await page.goto(SITE("plain") + "/");
  await sleep(2500);
  await page.locator("#user").fill("someone-new");
  await page.locator("#password").fill("A-new-password-1");
  await page.locator("#submit").click();
  await sleep(4000);
  await shot(page, "7-save-bar");
  console.log(`screenshots in ${out}`);
} finally {
  await context.close();
  fs.rmSync(path.join(here, "..", "..", "vaultwarden-test", "smartfill-state", "profile"), { recursive: true, force: true });
}
