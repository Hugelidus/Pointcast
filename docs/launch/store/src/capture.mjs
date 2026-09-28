// Captures the raw, real screenshots the store images are composed from, with the e2e build of
// the extension on dev/examples/react-dashboard, and the spec that recording produced.
//
//   node docs/launch/store/src/capture.mjs --wav <narration.wav> --words <narration.words.json> --out <dir>
//
// The narration is src/narration.json synthesized to a file with Windows SAPI (never played):
//   powershell -File dev/scripts/tts/generate.ps1 -ScriptJson <copy of narration.json in a temp dir>
// The compositions use, from <dir>: rec-export.png, popup-rec-export.png, pill-processing-NN.png
// (one with the dot lit), pill-done.png, popup-done.png, remote-page.png, popup-remote.png (copied
// into src/raw/), and session.md (src/spec-example.md). The pill positions in screenshot-1/2.html
// assume VIEWPORT below.
//
// Same approach as dev/eval/record.mjs: headless Chromium, muted, the narration WAV as the fake
// microphone, each Alt+click at the start of its word, Stop after one play-through. The e2e build
// (pnpm --filter @pointcast/extension build:e2e) records clipboard writes and notifications instead
// of performing them and loads Whisper from a local server (port 5541). Downloads go to a
// temporary folder, checked before recording. Needs ports 5174 (the example), 5541 and 5545 free.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const EXTENSION_DIR = path.join(REPO_ROOT, "packages", "extension", ".output", "chrome-mv3-e2e");
const EXAMPLE_DIR = path.join(REPO_ROOT, "dev", "examples", "react-dashboard");
const APP = "http://127.0.0.1:5174";
const MODEL_PORT = 5541;
const MODEL_ID = "Xenova/whisper-base";
/** A remote site for the privacy screenshot: resolved to this machine inside the test browser only. */
const REMOTE_HOST = "staging.example.com";
const REMOTE_PORT = 5545;
const INDICATOR = "[data-pointcast-ui] .rec";
const PROCESSING_TIMEOUT_MS = 180_000;
// Tall enough that the app ends above the pill in the page corner, which is translucent.
const VIEWPORT = { width: 1120, height: 780 };

/** SCENARIOS.md: «View report» of Revenue, the Messages «3», the Orders «Export». */
const GESTURES = [
  { name: "view-report", word: "this", occurrence: 1, target: 'section.stat-card:has(h3:text-is("Revenue")) a.stat-link' },
  { name: "badge", word: "this", occurrence: 2, target: 'nav a.nav-item:has-text("Messages") span.badge' },
  { name: "export", word: "this", occurrence: 3, target: "#orders-export" },
];

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
if (!args.wav || !args.words || !args.out) {
  console.error("usage: node capture.mjs --wav <narration.wav> --words <narration.words.json> --out <dir>");
  process.exit(1);
}
const OUT = path.resolve(args.out);
mkdirSync(OUT, { recursive: true });
if (!existsSync(path.join(EXTENSION_DIR, "manifest.json"))) throw new Error(`no e2e build at ${EXTENSION_DIR}`);

const normalize = (w) => w.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const words = JSON.parse(readFileSync(args.words, "utf8")).words;
const schedule = GESTURES.map((g) => {
  const atMs = words.filter((w) => normalize(w.text) === g.word)[g.occurrence - 1]?.startMs;
  if (atMs === undefined) throw new Error(`the narration does not say "${g.word}" ${g.occurrence} time(s)`);
  return { ...g, atMs };
});
const log = [];
const note = (line) => {
  console.log(line);
  log.push(line);
};

const cleanup = [];
try {
  cleanup.push(serveModel());
  cleanup.push(await startExample());
  cleanup.push(await startRemoteProxy());
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pointcast-store-"));
  cleanup.push(() => rmSync(tempDir, { recursive: true, force: true }));
  const downloadsDir = path.join(tempDir, "downloads");
  const context = await launch(tempDir, downloadsDir);
  cleanup.push(() => context.close());
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const setup = await context.newPage();
  for (const blank of context.pages().filter((p) => p !== setup && p.url() === "about:blank")) await blank.close();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await setup.evaluate(() => chrome.storage.local.set({ settings: { language: "en", keepAudio: false, notify: true } }));

  // 1. A remote site, first, while the profile has no recording yet: off until enabled, one host
  // at a time. Extensions.triggerAction is the toolbar button: Chrome grants activeTab for the
  // tab and opens the popup, which then offers "Enable on <host>".
  const remote = await context.newPage();
  await remote.goto(`http://${REMOTE_HOST}:${REMOTE_PORT}/`, { waitUntil: "load" });
  await remote.waitForTimeout(1500);
  await shoot(context, remote, "remote-page.png");
  // The extension cannot see the URL of a remote tab: it is the newest tab without one.
  const ids = await setup.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url ?? "" })));
  const remoteId = Math.max(...ids.filter((t) => t.url === "").map((t) => t.id));
  const remotePopup = await context.newPage();
  await remotePopup.setViewportSize({ width: 260, height: 700 });
  const showRemote = async (name) => {
    await remotePopup.goto(`chrome-extension://${extensionId}/popup.html?tab=${remoteId}`);
    await remotePopup.locator("#tab-status[data-tone='warning']").waitFor({ timeout: 10_000 });
    await sleep(800);
    await popupShot(remotePopup, name);
    const site = (await remotePopup.locator("#site").isVisible()) ? await remotePopup.locator("#site").innerText() : "(no site section)";
    note(`${name}: ${await remotePopup.locator("#tab-status").innerText()} | ${site.replaceAll("\n", " / ")}`);
  };
  await showRemote("popup-remote-unseen.png");
  // The toolbar button, as the protocol presses it: Chrome grants activeTab for the tab (and
  // opens the real popup, which Playwright does not expose; the one in a tab shows the same).
  await remote.bringToFront();
  const browserCdp = await context.browser()?.newBrowserCDPSession();
  if (!browserCdp) throw new Error("no browser CDP session");
  const { targetInfos } = await browserCdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  const tab = targetInfos.find((t) => t.url.startsWith(`http://${REMOTE_HOST}`));
  if (!tab) throw new Error(`no tab target for ${REMOTE_HOST}`);
  await browserCdp.send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
  await browserCdp.detach();
  await sleep(2000);
  await showRemote("popup-remote.png");
  await remotePopup.close();
  await remote.close();

  // 2. The app, with the popup reporting on its tab.
  const app = await context.newPage();
  await app.goto(`${APP}/`, { waitUntil: "networkidle" });
  const appTabId = await tabIdOf(setup, `${APP}/*`);
  await setup.close();
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 260, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${appTabId}`);
  await app.bringToFront();
  await shoot(context, app, "app-idle.png");

  // Warm-up: the first Stop of a fresh profile loads the model and measures this machine's speed,
  // so the real recording shows the usual "Processing… ~0:05" instead of the first-run download.
  await start(popup);
  await sleep(3000);
  await stop(popup);
  await sleep(6000);

  // 3. The recording.
  await popupShot(popup, "popup-idle.png");
  const t0 = await start(popup);
  await app.bringToFront();
  await app.locator(INDICATOR).waitFor({ state: "visible", timeout: 15_000 });
  for (const g of schedule) {
    await app.bringToFront();
    const pressedMs = g.atMs + (await altClick(app, g.target, t0 + g.atMs));
    // The capture flash lasts 400 ms: grab the page right away.
    await shoot(context, app, `rec-${g.name}.png`);
    note(`${g.name}: "${g.word}" #${g.occurrence} at ${g.atMs} ms, pressed at ${pressedMs} ms (flash shot ${Date.now() - t0 - pressedMs} ms after)`);
    await sleep(500);
    await popup.bringToFront();
    await sleep(300);
    await popupShot(popup, `popup-rec-${g.name}.png`);
  }
  await sleepUntil(t0 + wavDurationMs(args.wav) + 300);

  // 4. Stop: the popup's button, then the page's pill while processing and when done.
  await popup.bringToFront();
  await popup.locator("#toggle").click();
  await app.bringToFront();
  let n = 0;
  for (;;) {
    const { status } = await recorderState(popup);
    if (status === "idle") break;
    await shoot(context, app, `pill-processing-${String(++n).padStart(2, "0")}.png`);
    await sleep(300);
  }
  await shoot(context, app, "pill-done.png");
  const state = await recorderState(popup);
  if (state.error) throw new Error(`the extension failed: ${JSON.stringify(state.error)}`);
  await popup.bringToFront();
  await sleep(500);
  await popupShot(popup, "popup-done.png");

  // 5. The spec: session.md as saved, and what the e2e build recorded as the clipboard write.
  const folder = path.join(downloadsDir, "pointcast", state.lastSessionId);
  const markdown = readFileSync(path.join(folder, "session.md"), "utf8");
  const { e2eRecords = [] } = await popup.evaluate(() => chrome.storage.session.get("e2eRecords"));
  const copied = e2eRecords.filter((r) => r.kind === "clipboard").at(-1)?.text;
  note(`clipboard ${copied === markdown ? "equals" : "DIFFERS FROM"} session.md`);
  writeFileSync(path.join(OUT, "session.md"), markdown);
  writeFileSync(path.join(OUT, "session.json"), readFileSync(path.join(folder, "session.json")));
  writeFileSync(path.join(OUT, "words.json"), readFileSync(path.join(folder, "words.json")));

  // Settings, as the popup shows them once "Settings" is opened.
  await popup.locator(".settings summary").click();
  await sleep(200);
  await popupShot(popup, "popup-settings.png");
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      // keep cleaning up
    }
  }
  writeFileSync(path.join(OUT, "capture-log.txt"), `${log.join("\n")}\n`);
}

function lowerPriority(pid) {
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // not fatal
  }
}

function killTree(pid) {
  if (pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(pid);
}

/** transformers.js' model cache, served to the e2e build as dev/playwright.config.ts does. */
function serveModel() {
  const fromTranscribe = createRequire(path.join(REPO_ROOT, "packages", "transcribe", "package.json"));
  const cacheDir = path.join(path.dirname(fromTranscribe.resolve("@huggingface/transformers")), "..", ".cache");
  if (!existsSync(path.join(cacheDir, MODEL_ID, "onnx", "encoder_model.onnx"))) throw new Error(`${MODEL_ID} is not in ${cacheDir}`);
  const httpServer = path.join(REPO_ROOT, "node_modules", "http-server", "bin", "http-server");
  const child = spawn(process.execPath, [httpServer, cacheDir, "-p", String(MODEL_PORT), "-a", "127.0.0.1", "--cors", "-c-1", "-s"], {
    stdio: "ignore",
    windowsHide: true,
  });
  lowerPriority(child.pid);
  return () => killTree(child.pid);
}

/** The example's Vite dev server (what `pnpm example:react` runs), with no browser opening. */
async function startExample() {
  const vite = path.join(EXAMPLE_DIR, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: EXAMPLE_DIR,
    env: { ...process.env, BROWSER: "none" },
    stdio: "ignore",
    windowsHide: true,
  });
  lowerPriority(child.pid);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${APP}/`)).ok) break;
    } catch {
      // not yet
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      killTree(child.pid);
      throw new Error("the example's dev server did not start");
    }
    await sleep(500);
  }
  return () => killTree(child.pid);
}

/** The same app as a "remote" site: a proxy that presents itself to Vite as 127.0.0.1:5174. */
async function startRemoteProxy() {
  const server = createServer((req, res) => {
    const upstream = httpRequest(
      { host: "127.0.0.1", port: 5174, path: req.url, method: req.method, headers: { ...req.headers, host: "127.0.0.1:5174" } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(REMOTE_PORT, "127.0.0.1", resolve);
  });
  return () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
}

async function launch(tempDir, downloadsDir) {
  const userDataDir = path.join(tempDir, "profile");
  mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });
  writeFileSync(
    path.join(userDataDir, "Default", "Preferences"),
    JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }),
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--mute-audio",
      // English UI, so the popup's shortcut hints read "Alt+Shift+S" on any machine.
      "--lang=en-US",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${path.resolve(args.wav)}`,
      `--host-resolver-rules=MAP ${REMOTE_HOST} 127.0.0.1`,
      // Lets the protocol press the toolbar button (Extensions.triggerAction), as a user would.
      "--enable-unsafe-extension-debugging",
    ],
  });
  // As dev/e2e/support/fixtures.ts: downloads go back to Chrome only once the profile's folder is proven temporary.
  const settings = await context.newPage();
  await settings.goto("chrome://settings/downloads");
  const shown = (await settings.locator("#defaultDownloadPath").innerText()).trim();
  await settings.close();
  if (path.resolve(shown) !== path.resolve(downloadsDir)) {
    await context.close();
    throw new Error(`refusing to run: the profile would download into "${shown}"`);
  }
  const cdp = await context.browser()?.newBrowserCDPSession();
  if (!cdp) throw new Error("persistent context without a browser CDP session");
  await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
  await cdp.detach();
  return context;
}

async function tabIdOf(extensionPage, urlPattern) {
  const tabs = await extensionPage.evaluate((url) => chrome.tabs.query({ url }), urlPattern);
  if (tabs.length !== 1) throw new Error(`expected one tab for ${urlPattern}, found ${tabs.length}`);
  return tabs[0].id;
}

async function recorderState(popup) {
  const { recorder } = await popup.evaluate(() => chrome.storage.session.get("recorder"));
  return recorder ?? { status: "idle" };
}

async function waitForStatus(popup, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await recorderState(popup);
    if (state.status === status) return state;
    if (Date.now() > deadline) throw new Error(`recorder still "${state.status}" after ${timeoutMs} ms`);
    await sleep(250);
  }
}

async function start(popup) {
  await popup.bringToFront();
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "recording", 15_000);
  return state.t0;
}

async function stop(popup) {
  await popup.bringToFront();
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  if (state.error) throw new Error(`the extension failed: ${JSON.stringify(state.error)}`);
  return state;
}

async function altClick(page, selector, at) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.keyboard.down("Alt");
  try {
    const lead = at - Date.now();
    if (lead < 150) console.warn(`late: ${selector} prepared ${lead} ms before its word`);
    await sleepUntil(at);
    const pressed = Date.now();
    await page.mouse.click(x, y);
    // How late the press was, in ms after its word.
    return pressed - at;
  } finally {
    await page.keyboard.up("Alt");
  }
}

/**
 * The page's viewport, at the context's scale. Playwright's own call: a raw protocol capture from a
 * second session sees the page without Playwright's viewport emulation.
 */
async function shoot(_context, page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
}

async function popupShot(popup, name) {
  await popup.locator("body").screenshot({ path: path.join(OUT, name) });
}

function wavDurationMs(file) {
  const bytes = readFileSync(file);
  const rate = bytes.readUInt32LE(24);
  const dataStart = bytes.indexOf("data", 12) + 8;
  return ((bytes.length - dataStart) / 2 / rate) * 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepUntil(epochMs) {
  const wait = epochMs - Date.now();
  if (wait > 0) await sleep(wait);
}
