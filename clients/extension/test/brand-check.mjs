#!/usr/bin/env node
// Checks that a built extension carries the brand: its name, no Bitwarden blue in stylesheets or
// UI scripts, "Bitwarden" renamed in the texts (except where it names Bitwarden itself), the
// copyright and GPL notices kept. Usage: node test/brand-check.mjs [build/chrome-mv3|build/firefox-mv2]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["chrome-mv3", "firefox-mv2"].map((d) => path.join(here, "..", "build", d));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  failures += ok ? 0 : 1;
};
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

for (const dir of dirs) {
  console.log(`\n${dir}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  check(!/bitwarden/i.test(manifest.name), `extension name is "${manifest.name}"`);
  check(/based on Bitwarden/.test(manifest.description), "description says it is based on Bitwarden");
  check(fs.existsSync(path.join(dir, "LICENSE_GPL.txt")) && fs.existsSync(path.join(dir, "NOTICE.txt")), "GPL licence and notice are shipped");

  const files = walk(dir).filter((f) => /\.(css|js)$/.test(f) && !/(^|\/)background\.js$|wasm/.test(f));
  const blue = files.filter((f) => /#175ddc|rgba?\(\s*23,\s*93,\s*220\b|23 93 220\b/i.test(fs.readFileSync(f, "utf8")));
  check(blue.length === 0, `no Bitwarden blue in ${files.length} stylesheets and UI scripts${blue.length ? `: ${blue.map((f) => path.relative(dir, f)).join(", ")}` : ""}`);

  const en = JSON.parse(fs.readFileSync(path.join(dir, "_locales", "en", "messages.json"), "utf8"));
  check(en.appName.message !== "Bitwarden" && en.introCarouselLabel.message.includes(manifest.name), `texts use the name ("${en.introCarouselLabel.message}")`);
  check(/Bitwarden/.test(en.moreFromBitwarden.message) && /Bitwarden/.test(en.downloadBitwardenApps.message), "links to Bitwarden's site keep its name");
  const copyright = Object.values(en).find((m) => /©/.test(m.message ?? ""));
  check(!copyright || /Bitwarden/.test(copyright.message), "copyright line keeps Bitwarden");
  const fr = JSON.parse(fs.readFileSync(path.join(dir, "_locales", "fr", "messages.json"), "utf8"));
  check(!/Bitwarden/.test(fr.introCarouselLabel.message), `French texts too ("${fr.introCarouselLabel.message}")`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall brand checks passed");
process.exit(failures ? 1 : 0);
