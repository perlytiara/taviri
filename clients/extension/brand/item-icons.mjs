#!/usr/bin/env node
// Taviri item icons: an icon pack drawn like the owner's app family (the author's app icon set: a
// rounded tile, a cream glyph, one accent, 6.5 strokes with round ends), in Taviri's palette:
// red tile #C62D35, cream glyph #F3EFE7, dark accent #16171B (the owner's pick, "B · red tile",
// 2026-11-15; the family itself is dark tile, cream glyph, orange accent).
//
// It takes the 16 app icons of the family (read-only from the author's app icon set), recoloured
// to the palette, and adds glyphs for the kinds of vault items that have no website icon: notes,
// SSH keys, cards, Wi-Fi, servers, wallets…
//
// Writes:
//   <fork>/libs/common/src/vault/icon/taviri-icon-pack.ts   the pack, as 96 px PNG data URLs
//   brand/item-icons/<id>.svg                                each icon as SVG
//   brand/item-icons-preview.png                             a contact sheet to look at
// Rasterised by the headless test browser (Chrome for Testing). Run again after editing a glyph.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromeForTesting, CLIENTS_DIR } from "../test/e2e-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(CLIENTS_DIR, "node_modules", "playwright"));

const FAMILY_DIR = process.env.TAVIRI_FAMILY_ICONS || path.join(here, "family");
const OUT_SVG = path.join(here, "item-icons");
const OUT_TS = path.join(CLIENTS_DIR, "libs", "common", "src", "vault", "icon", "taviri-icon-pack.ts");
// The pack's palette: tile (also the colour of cut-outs inside glyphs), glyph, accent.
const BG = "#C62D35";
const INK = "#F3EFE7";
const ACC = "#16171B";
// The app family's own colours, swapped for the palette's when its icons are copied.
const FAMILY = { tile: "#16171B", glyph: "#F3EFE7", accent: "#FF6A2B" };
const toPalette = (svg) =>
  svg
    .replace(new RegExp(FAMILY.tile, "gi"), "@@tile@@")
    .replace(new RegExp(FAMILY.glyph, "gi"), "@@glyph@@")
    .replace(new RegExp(FAMILY.accent, "gi"), "@@accent@@")
    .replace(/@@tile@@/g, BG)
    .replace(/@@glyph@@/g, INK)
    .replace(/@@accent@@/g, ACC);
const SW = 6.5;

const rr = (x, y, w, h, r) =>
  `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
const circle = (cx, cy, r) => `M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`;
const fill = (color, d) => `<path d="${d}" fill="${color}"/>`;
const line = (color, d, width = SW) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** New glyphs, drawn on the family's 108 canvas (tile 18..90, glyph inside 30..78). */
const GLYPHS = {
  note: {
    label: "Note",
    body: fill(INK, rr(35, 30, 38, 48, 6)) + line(BG, "M43,43 H65", 4.5) + line(BG, "M43,52 H65", 4.5) + line(ACC, "M43,61 H56", 4.5),
  },
  terminal: {
    label: "SSH / terminal",
    body: line(INK, rr(30, 35, 48, 38, 7)) + line(INK, "M40,47 L47,54 L40,61") + line(ACC, "M53,61 H66"),
  },
  key: {
    label: "Key",
    body: line(INK, circle(42, 54, 9)) + line(INK, "M51,54 H76") + line(INK, "M70,54 V62") + line(ACC, "M62,54 V60"),
  },
  card: {
    label: "Bank card",
    body: fill(INK, rr(30, 37, 48, 34, 6)) + line(BG, "M30,47 H78", 5) + fill(ACC, rr(36, 56, 12, 9, 2.5)),
  },
  identity: {
    label: "Identity",
    body:
      fill(INK, rr(30, 37, 48, 34, 6)) +
      fill(BG, circle(43, 50, 5)) +
      fill(BG, "M34,66 C34,58 52,58 52,66 Z") +
      line(ACC, "M58,49 H70", 4.5) +
      line(BG, "M58,58 H70", 4.5),
  },
  wifi: {
    label: "Wi-Fi",
    body:
      line(INK, "M33,48 C45,36 63,36 75,48") +
      line(INK, "M40,56 C48,48 60,48 68,56") +
      fill(ACC, circle(54, 66, 5)),
  },
  server: {
    label: "Server",
    body:
      fill(INK, rr(32, 32, 44, 18, 5)) +
      fill(INK, rr(32, 56, 44, 18, 5)) +
      fill(ACC, circle(41, 41, 3.5)) +
      fill(ACC, circle(41, 65, 3.5)) +
      line(BG, "M52,41 H67", 4) +
      line(BG, "M52,65 H67", 4),
  },
  wallet: {
    label: "Wallet / crypto",
    body: fill(INK, rr(30, 38, 48, 34, 7)) + fill(INK, "M34,38 L62,30 L66,38 Z") + fill(BG, rr(58, 48, 20, 14, 5)) + fill(ACC, circle(66, 55, 3.5)),
  },
  mail: {
    label: "E-mail",
    body: fill(INK, rr(30, 38, 48, 34, 6)) + line(BG, "M33,41 L54,57 L75,41", 4.5) + fill(ACC, circle(76, 38, 6)),
  },
  bank: {
    label: "Bank",
    body:
      fill(INK, "M54,30 L77,42 H31 Z") +
      line(INK, "M38,48 V66") +
      line(INK, "M54,48 V66") +
      line(INK, "M70,48 V66") +
      fill(ACC, rr(31, 70, 46, 7, 3)),
  },
  phone: {
    label: "Phone / SIM",
    body: fill(INK, rr(40, 30, 28, 48, 7)) + fill(BG, rr(44, 36, 20, 30, 3)) + fill(ACC, circle(54, 71, 3)),
  },
  code: {
    label: "Code / API",
    body: line(INK, "M42,42 L32,54 L42,66") + line(INK, "M66,42 L76,54 L66,66") + line(ACC, "M58,38 L50,70"),
  },
  licence: {
    label: "Licence / serial",
    body:
      fill(INK, "M30,38 H78 V48 A6,6 0 0 0 78,60 V70 H30 V60 A6,6 0 0 0 30,48 Z") +
      line(BG, "M44,38 V70", 3) +
      fill(ACC, circle(61, 54, 6)),
  },
  game: {
    label: "Game",
    body:
      fill(INK, "M40,40 H68 C76,40 79,48 79,57 C79,66 74,71 69,67 L63,62 H45 L39,67 C34,71 29,66 29,57 C29,48 32,40 40,40 Z") +
      line(BG, "M42,49 V59 M37,54 H47", 4) +
      fill(ACC, circle(64, 51, 3.5)) +
      fill(ACC, circle(70, 57, 3.5)),
  },
  cloud: {
    label: "Cloud",
    body: fill(INK, "M40,68 A11,11 0 0 1 39,46 A15,15 0 0 1 67,44 A12,12 0 0 1 68,68 Z") + line(ACC, "M54,63 V52 M49,56 L54,51 L59,56", 4.5),
  },
  home: {
    label: "Home / router",
    body: fill(INK, "M54,31 L78,51 H71 V76 H37 V51 H30 Z") + fill(ACC, rr(49, 60, 10, 16, 3)),
  },
  lock: {
    label: "Lock",
    body: line(INK, "M43,49 V43 A11,11 0 0 1 65,43 V49") + fill(INK, rr(34, 49, 40, 28, 6)) + fill(ACC, circle(54, 60, 4)) + fill(ACC, rr(52, 61, 4, 9, 2)),
  },
  globe: {
    label: "Website",
    body: line(INK, circle(54, 54, 22)) + line(INK, "M33,54 H75") + line(ACC, "M54,32 C43,44 43,64 54,76 C65,64 65,44 54,32", 4.5),
  },
  shop: {
    label: "Shop",
    body: fill(INK, "M34,44 H74 L71,76 H37 Z") + line(ACC, "M44,50 V42 A10,10 0 0 1 64,42 V50", 4.5),
  },
  chat: {
    label: "Messages",
    body:
      fill(INK, "M36,33 H72 A6,6 0 0 1 78,39 V61 A6,6 0 0 1 72,67 H50 L39,76 V67 H36 A6,6 0 0 1 30,61 V39 A6,6 0 0 1 36,33 Z") +
      fill(ACC, circle(43, 50, 3.5)) +
      fill(BG, circle(54, 50, 3.5)) +
      fill(BG, circle(65, 50, 3.5)),
  },
  play: {
    label: "Video / streaming",
    body: fill(INK, rr(30, 36, 48, 36, 8)) + fill(ACC, "M49,45 L63,54 L49,63 Z"),
  },
  music: {
    label: "Music",
    body: line(INK, "M47,66 V36 L71,31 V61") + fill(INK, circle(42, 66, 7)) + fill(ACC, circle(66, 61, 7)),
  },
  work: {
    label: "Work",
    body: line(INK, "M45,40 V35 A3,3 0 0 1 48,32 H60 A3,3 0 0 1 63,35 V40") + fill(INK, rr(30, 40, 48, 34, 6)) + fill(ACC, rr(49, 52, 10, 8, 2)),
  },
  school: {
    label: "School",
    body: fill(INK, "M54,32 L80,44 L54,56 L28,44 Z") + fill(INK, "M38,51 V62 C38,70 70,70 70,62 V51 L54,59 Z") + line(ACC, "M76,46 V62", 4),
  },
  health: {
    label: "Health",
    body: fill(INK, "M47,32 H61 V47 H76 V61 H61 V76 H47 V61 H32 V47 H47 Z") + fill(ACC, circle(54, 54, 4)),
  },
  travel: {
    label: "Travel",
    body: fill(INK, "M30,52 L78,32 L64,78 L54,60 Z") + fill(ACC, "M54,60 L78,32 L58,66 Z"),
  },
  photo: {
    label: "Photos",
    body: fill(INK, "M30,44 A6,6 0 0 1 36,38 H44 L48,32 H60 L64,38 H72 A6,6 0 0 1 78,44 V70 A6,6 0 0 1 72,76 H36 A6,6 0 0 1 30,70 Z") + fill(BG, circle(54, 57, 11)) + fill(ACC, circle(54, 57, 6)),
  },
  codes: {
    label: "Recovery codes",
    body:
      fill(INK, rr(32, 32, 12, 12, 3)) +
      fill(INK, rr(48, 32, 12, 12, 3)) +
      fill(INK, rr(64, 32, 12, 12, 3)) +
      fill(INK, rr(32, 48, 12, 12, 3)) +
      fill(ACC, rr(48, 48, 12, 12, 3)) +
      fill(INK, rr(64, 48, 12, 12, 3)) +
      fill(INK, rr(32, 64, 12, 12, 3)) +
      fill(INK, rr(48, 64, 12, 12, 3)) +
      fill(INK, rr(64, 64, 12, 12, 3)),
  },
  shield: {
    label: "Two-step / security",
    body:
      fill(INK, "M54,30 L74,37.5 V52 C74,64.5 65.5,73.5 54,78 C42.5,73.5 34,64.5 34,52 V37.5 Z") +
      line(ACC, "M45,54 L52,61 L64,47", 5.5),
  },
  laptop: {
    label: "Computer / devices",
    body: fill(INK, rr(34, 33, 40, 29, 5)) + fill(BG, rr(38.5, 37.5, 31, 20, 2)) + line(ACC, "M44,52 H55", 4) + fill(INK, rr(28, 66, 52, 8, 4)),
  },
  user: {
    label: "Account",
    body: fill(INK, circle(54, 44, 11)) + fill(INK, "M32,76 C32,58 76,58 76,76 Z") + fill(ACC, circle(70, 38, 5)),
  },
};

const tile = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="18 18 72 72">\n  <rect x="18" y="18" width="72" height="72" rx="20" fill="${BG}"/>\n  ${inner}\n</svg>\n`;

/** The pack: the family's app icons (unchanged) plus the new glyphs. */
function pack() {
  const icons = {};
  const family = JSON.parse(fs.readFileSync(path.join(FAMILY_DIR, "family.json"), "utf8")).icons;
  for (const [id, meta] of Object.entries(family)) {
    const file = path.join(FAMILY_DIR, "svg", `${id}.svg`);
    if (fs.existsSync(file)) {
      icons[id] = { label: meta.label, group: "apps", svg: toPalette(fs.readFileSync(file, "utf8")) };
    }
  }
  for (const [id, glyph] of Object.entries(GLYPHS)) {
    icons[id] = { label: glyph.label, group: "items", svg: tile(glyph.body) };
  }
  return icons;
}

const icons = pack();
fs.rmSync(OUT_SVG, { recursive: true, force: true });
fs.mkdirSync(OUT_SVG, { recursive: true });
for (const [id, icon] of Object.entries(icons)) {
  fs.writeFileSync(path.join(OUT_SVG, `${id}.svg`), icon.svg);
}

fs.writeFileSync(
  path.join(OUT_SVG, "pack.json"),
  JSON.stringify(
    {
      field: "taviri:icon",
      palette: { tile: BG, glyph: INK, accent: ACC },
      note: "Icon ids for the taviri:icon custom field. Generated by brand/item-icons.mjs.",
      icons: Object.fromEntries(Object.entries(icons).map(([id, icon]) => [id, { label: icon.label, group: icon.group, svg: `${id}.svg`, png: `png/${id}.png` }])),
    },
    null,
    2,
  ) + "\n",
);
fs.mkdirSync(path.join(OUT_SVG, "png"), { recursive: true });

const browser = await chromium.launch({ executablePath: chromeForTesting(), headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const png = {};
for (const [id, icon] of Object.entries(icons)) {
  await page.setViewportSize({ width: 96, height: 96 });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${dataUrl(icon.svg)}" width="96" height="96"></body></html>`);
  await page.waitForFunction(() => document.querySelector("img").complete);
  const buffer = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 96, height: 96 } });
  png[id] = `data:image/png;base64,${buffer.toString("base64")}`;
  fs.writeFileSync(path.join(OUT_SVG, "png", `${id}.png`), buffer);
}

// Contact sheet.
const cells = Object.entries(icons)
  .map(([id, icon]) => `<div class="c"><img src="${dataUrl(icon.svg)}"><b>${id}</b><span>${icon.label}</span></div>`)
  .join("");
await page.setViewportSize({ width: 1240, height: 200 });
await page.setContent(`<html><body style="margin:0;background:#2b2d33;font:13px -apple-system,Helvetica,Arial">
  <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:18px;padding:24px">${cells}</div>
  <style>.c{display:flex;flex-direction:column;align-items:center;color:#f3efe7}.c img{width:84px;height:84px}.c b{margin-top:6px}.c span{opacity:.7;font-size:11px}</style></body></html>`);
const height = await page.evaluate(() => document.body.scrollHeight);
await page.setViewportSize({ width: 1240, height });
await page.screenshot({ path: path.join(here, "item-icons-preview.png") });
await browser.close();

const ts = `/**
 * Taviri fork — the item icon pack, generated by \`bitwarden-smartfill/brand/item-icons.mjs\` (do not
 * edit by hand). Icons in the owner's app family style: the family's app icons plus glyphs for
 * items without a website icon. An item picks one with a text custom field named
 * \`${"taviri:icon"}\` (see \`taviri-item-icon.ts\`). 96 px PNGs, so every client can show them offline.
 */
export const TAVIRI_ICON_PACK: Readonly<Record<string, { label: string; group: "apps" | "items"; image: string }>> = {
${Object.entries(icons)
  .map(([id, icon]) => `  ${JSON.stringify(id)}: {\n    label: ${JSON.stringify(icon.label)},\n    group: ${JSON.stringify(icon.group)},\n    image:\n      ${JSON.stringify(png[id])},\n  },`)
  .join("\n")}
};
`;
fs.writeFileSync(OUT_TS, ts);
execFileSync("npx", ["prettier", "--write", OUT_TS], { cwd: CLIENTS_DIR, stdio: "ignore" });
console.log(`${Object.keys(icons).length} icons (${Object.values(icons).filter((i) => i.group === "apps").length} app icons from the family, ${Object.keys(GLYPHS).length} item glyphs)`);
console.log(`→ ${OUT_TS} (${Math.round(fs.statSync(OUT_TS).size / 1024)} KB)`);
console.log(`→ ${path.join(here, "item-icons-preview.png")}`);
