#!/usr/bin/env node
// Makes the extension's icon set (toolbar + extension icons, in the logged-in, logged-out and
// locked states) and writes it into the fork's brand folder
// (apps/browser/webpack/smartfill-brand/images). Rebuild afterwards.
//
//   node brand/make-icons.mjs                      placeholder: the first letter of the name on a tile
//   node brand/make-icons.mjs --mark mark.svg      a square SVG mark from the brand kit
//       [--gray mark-gray.svg] [--locked mark-locked.svg]   optional ready-made state variants
//       [--color "#047B62"]                        tile colour of the placeholder
//
// Without --gray / --locked the logged-out icon is the mark in grey and the locked icon is the
// mark with a small padlock badge. The SVGs are drawn by the headless test browser.
import fs from "node:fs";
import path from "node:path";

import { chromeForTesting, CLIENTS_DIR } from "../test/e2e-lib.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(CLIENTS_DIR, "node_modules", "playwright"));

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const brandDir = path.join(CLIENTS_DIR, "apps", "browser", "webpack", "smartfill-brand");
const outDir = path.join(brandDir, "images");
const brand = JSON.parse(fs.readFileSync(path.join(brandDir, "brand.json"), "utf8"));
const color = option("color") || "#047B62";

const ALL_SIZES = [16, 19, 32, 38, 48, 96, 128];
const TOOLBAR_SIZES = [19, 38];

function placeholderMark(tile) {
  const letter = String(brand.name || "?").trim().charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="6" y="6" width="116" height="116" rx="28" fill="${tile}"/>
  <text x="64" y="66" text-anchor="middle" dominant-baseline="central"
    font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="86" font-weight="700"
    fill="#ffffff">${letter}</text>
</svg>`;
}

const readSvg = (file) => fs.readFileSync(path.resolve(file), "utf8");
const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const lockBadge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" style="position:absolute;inset:0;width:100%;height:100%">
  <circle cx="94" cy="94" r="30" fill="#1f2933" stroke="#ffffff" stroke-width="7"/>
  <rect x="80" y="91" width="28" height="21" rx="4" fill="#ffffff"/>
  <path d="M85 92 v-7 a9 9 0 0 1 18 0 v7" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
</svg>`;

function variants() {
  const mark = option("mark");
  if (!mark) {
    return {
      "": { svg: placeholderMark(color) },
      _gray: { svg: placeholderMark("#8e939b") },
      _locked: { svg: placeholderMark(color), badge: true },
    };
  }
  const normal = readSvg(mark);
  return {
    "": { svg: normal },
    _gray: option("gray") ? { svg: readSvg(option("gray")) } : { svg: normal, gray: true },
    _locked: option("locked") ? { svg: readSvg(option("locked")) } : { svg: normal, badge: true },
  };
}

const browser = await chromium.launch({ executablePath: chromeForTesting(), headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
fs.mkdirSync(outDir, { recursive: true });
const written = [];

for (const [suffix, variant] of Object.entries(variants())) {
  const sizes = suffix === "_locked" ? TOOLBAR_SIZES : ALL_SIZES;
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <div style="position:relative;width:${size}px;height:${size}px">
        <img src="${dataUrl(variant.svg)}" style="position:absolute;inset:0;width:100%;height:100%;${variant.gray ? "filter:grayscale(1) opacity(.75);" : ""}">
        ${variant.badge ? lockBadge : ""}
      </div></body></html>`);
    await page.waitForFunction(() => {
      const image = document.querySelector("img");
      return image && image.complete && image.naturalWidth > 0;
    });
    const file = path.join(outDir, `icon${size}${suffix}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    written.push(path.basename(file));
  }
}

await browser.close();
console.log(`${written.length} icons for "${brand.name}" → ${outDir}`);
console.log(option("mark") ? `from ${option("mark")}` : `placeholder (letter on a ${color} tile)`);
