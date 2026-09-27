#!/usr/bin/env node
// Renders the pointcast toolbar icon from scripts/icon/pointcast.svg into
// packages/extension/public/icon/{16,32,48,128}.png using the repo's own
// Playwright Chromium (headless), so the icon can be regenerated any time
// without a separate image-processing dependency.
//
// WXT auto-detects public/icon/<size>.png and wires it into the manifest's
// `icons` map and the toolbar action icon — no manifest edits needed.
//
// Usage:
//   node scripts/icon/render.mjs
//     Renders the four PNG sizes into packages/extension/public/icon/.
//
//   node scripts/icon/render.mjs --preview <outPath>
//     Also renders a light/dark inspection sheet (all four sizes, against a
//     handful of representative toolbar backgrounds, plus a pixel-zoomed
//     16px crop) to <outPath>. Meant for eyeballing legibility during design,
//     not part of the extension build.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pages rendered via page.setContent() have no file:// origin, so Chromium
// refuses to load file:// image sources from them. Inlining as data URIs
// sidesteps that entirely (and keeps the preview sheet a single self
// contained render, no external file dependencies).
function pngDataUri(filePath) {
  return `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const svgPath = path.join(here, "pointcast.svg");
const outDir = path.join(repoRoot, "packages", "extension", "public", "icon");
const sizes = [16, 32, 48, 128];

const svgMarkup = readFileSync(svgPath, "utf8");

function iconPageHtml(sizePx) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    svg { display: block; width: ${sizePx}px; height: ${sizePx}px; }
  </style></head><body>${svgMarkup}</body></html>`;
}

async function renderIcons(browser) {
  mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const written = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(iconPageHtml(size));
    const outPath = path.join(outDir, `${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: true });
    written.push(outPath);
  }
  await page.close();
  return written;
}

// Representative toolbar backgrounds: Chrome/Edge light and dark toolbar
// grays, plus pure white/black as a legibility stress test.
const SWATCHES = [
  { name: "white", bg: "#ffffff" },
  { name: "chrome light toolbar", bg: "#f1f3f4" },
  { name: "chrome dark toolbar", bg: "#292a2d" },
  { name: "black", bg: "#000000" },
];

function previewPageHtml() {
  const dataUris = Object.fromEntries(
    sizes.map((size) => [size, pngDataUri(path.join(outDir, `${size}.png`))]),
  );

  const rows = sizes
    .map((size) => {
      const cells = SWATCHES.map(
        ({ name, bg }) => `
          <div class="cell" style="background:${bg}">
            <img src="${dataUris[size]}" width="${size}" height="${size}" />
            <div class="cap" style="color:${bg === "#000000" || bg === "#292a2d" ? "#e8eaed" : "#202124"}">${name}</div>
          </div>`,
      ).join("");
      return `
        <section>
          <h2>${size}px</h2>
          <div class="row">${cells}</div>
        </section>`;
    })
    .join("");

  const zoomCells = SWATCHES.map(
    ({ name, bg }) => `
      <div class="cell zoom" style="background:${bg}">
        <img src="${dataUris[16]}" width="128" height="128" style="image-rendering: pixelated;" />
        <div class="cap" style="color:${bg === "#000000" || bg === "#292a2d" ? "#e8eaed" : "#202124"}">${name}</div>
      </div>`,
  ).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; font: 14px/1.4 system-ui, sans-serif; background: #808080; }
    h1 { font-size: 18px; margin: 0 0 4px; color: #111; }
    h2 { font-size: 13px; margin: 16px 0 6px; color: #111; }
    .row { display: flex; gap: 12px; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px; border-radius: 6px; min-width: 90px; }
    .cell img { display: block; }
    .cap { font-size: 10px; text-align: center; }
    .zoom img { image-rendering: pixelated; }
  </style></head><body>
    <h1>pointcast icon — legibility sheet</h1>
    <section>
      <h2>16px, zoomed 8x (pixelated)</h2>
      <div class="row">${zoomCells}</div>
    </section>
    ${rows}
  </body></html>`;
}

async function renderPreview(browser, outPath) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(previewPageHtml());
  const body = page.locator("body");
  const box = await body.boundingBox();
  await page.setViewportSize({
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
  });
  mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  await page.close();
}

async function main() {
  const args = process.argv.slice(2);
  const previewFlagIndex = args.indexOf("--preview");
  const previewOutPath = previewFlagIndex >= 0 ? args[previewFlagIndex + 1] : null;

  const browser = await chromium.launch({ args: ["--mute-audio"] });
  try {
    const written = await renderIcons(browser);
    for (const file of written) {
      console.log(`wrote ${path.relative(repoRoot, file)}`);
    }
    if (previewOutPath) {
      await renderPreview(browser, previewOutPath);
      console.log(`wrote preview sheet: ${previewOutPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
