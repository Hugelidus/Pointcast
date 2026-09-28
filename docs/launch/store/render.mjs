// Renders the Chrome Web Store images from src/*.html: the screenshots (screenshot-N, 1280x800),
// the promo tiles (promo-small 440x280, promo-marquee 1400x560) and the GitHub social preview
// (social-preview 1280x640), each to <name>.png next to this file.
//
//   node docs/launch/store/render.mjs                  # all of them
//   node docs/launch/store/render.mjs 1 3 promo-small  # only these (a number is a screenshot)
//
// The pages are served from the repository root on 127.0.0.1 (they read src/spec-example.md and
// the logo in dev/scripts/icon/, which file:// pages cannot fetch) and rendered by headless Chromium
// at device scale 1. Fonts come from Google Fonts; offline, the system fallbacks are used.
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".js": "text/javascript" };

/** Each page's size; every screenshot is 1280x800. */
const SIZES = { "promo-small": [440, 280], "promo-marquee": [1400, 560], "social-preview": [1280, 640] };
const sizeOf = (base) => SIZES[base] ?? [1280, 800];

const wanted = process.argv.slice(2).map((arg) => (/^\d+$/.test(arg) ? `screenshot-${arg}` : arg));
const pages = (await readdir(path.join(HERE, "src")))
  .filter((name) => /^screenshot-\d+\.html$/.test(name) || Object.hasOwn(SIZES, name.replace(/\.html$/, "")))
  .filter((name) => wanted.length === 0 || wanted.includes(name.replace(/\.html$/, "")))
  .sort();

const server = createServer(async (request, response) => {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  if (!file.startsWith(ROOT + path.sep)) return response.writeHead(404).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  for (const name of pages) {
    const [width, height] = sizeOf(name.replace(/\.html$/, ""));
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const url = `${origin}/${path.relative(ROOT, path.join(HERE, "src", name)).split(path.sep).join("/")}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(HERE, name.replace(/\.html$/, ".png"));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
    await page.close();
    // Chrome writes opaque pages as 8-bit RGB PNGs (colour type 2): the store's "24-bit, no alpha".
    const header = await readFile(out);
    const rgb = header.readUInt32BE(16) === width && header.readUInt32BE(20) === height && header[24] === 8 && header[25] === 2;
    console.log(`${path.basename(out)}${rgb ? "" : `  (WARNING: not a ${width}x${height} 24-bit RGB PNG)`}`);
  }
} finally {
  await browser.close();
  server.close();
}
