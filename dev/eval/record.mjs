// Records one scenario with the built extension, like a person narrating and pointing:
// headless Chromium plays the scenario's narration.wav as the microphone, the script performs each
// gesture at the start of its word on the running app, presses Stop and collects the session.
//
//   node dev/eval/record.mjs <app> [--extension <dir>]
//
// Output: dev/eval/.runs/sessions/<app>/ with the extension's files (session.json, words.json,
// session.md, audio.wav), clipboard.md (what the extension copied) and gestures.json (planned vs
// actual times). Modeled on dev/e2e/capture.spec.ts and its helpers in dev/e2e/support/.
//
// Uses the e2e build (packages/extension/.output/chrome-mv3-e2e) by default: it is the same
// extension, but it records clipboard writes and notifications instead of performing them (this
// runs on the user's own machine) and loads Whisper from a local server instead of downloading
// 291 MB from Hugging Face into every fresh profile. The integration step builds it (pnpm e2e).
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { REPO_ROOT, RUNS_DIR, appByName, killTree, lowerPriority, readScenario, startDevServer } from "./lib/apps.mjs";
import { readNarration, scheduleGestures } from "./lib/narration.mjs";

const [appName, ...rest] = process.argv.slice(2);
if (!appName) {
  console.error("usage: node dev/eval/record.mjs <app> [--extension <dir>]");
  process.exit(1);
}
const flag = rest.indexOf("--extension");
const EXTENSION_DIR = flag >= 0 ? path.resolve(rest[flag + 1]) : path.join(REPO_ROOT, "packages", "extension", ".output", "chrome-mv3-e2e");
// The e2e build fetches the model from here (packages/extension/.env.e2e).
const MODEL_PORT = 5541;
const MODEL_ID = "Xenova/whisper-base";
/** Popup and page selectors the e2e suite also relies on (dev/e2e/support/recorder.ts, scenario.ts). */
const TOGGLE = "#toggle";
const INDICATOR = "[data-pointcast-ui] .rec";
/** Stop → Markdown: model load in a fresh profile + Whisper on ~35 s of audio, on a busy machine. */
const PROCESSING_TIMEOUT_MS = 180_000;
/** A gesture needs this long before its word to scroll and measure its element. */
const MIN_LEAD_MS = 150;

const app = appByName(appName);
const scenario = readScenario(appName);
const narration = readNarration(appName);
const gestures = scheduleGestures(scenario.gestures, narration.words);
const outDir = path.join(RUNS_DIR, "sessions", appName);
if (!existsSync(path.join(EXTENSION_DIR, "manifest.json"))) throw new Error(`no extension build at ${EXTENSION_DIR}`);

const cleanup = [];
try {
  cleanup.push(serveModel());
  const server = await startDevServer(app);
  cleanup.push(server.stop);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pointcast-eval-"));
  cleanup.push(() => rmSync(tempDir, { recursive: true, force: true }));
  const downloadsDir = path.join(tempDir, "downloads");
  const context = await launch(tempDir, downloadsDir);
  cleanup.push(() => context.close());

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  // Spanish narration: no language guessing; keep the audio to check sync afterwards.
  await popup.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, language: "es", keepAudio: true } });
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.url}${scenario.startPath ?? "/"}`, { waitUntil: "networkidle" });

  const t0 = await start(popup);
  await page.bringToFront();
  await page.locator(INDICATOR).waitFor({ state: "visible", timeout: 15_000 });
  const performed = [];
  for (const g of gestures) performed.push(await perform(page, g, t0));

  // The fake microphone loops the WAV: stop right after one full play-through.
  await sleepUntil(t0 + wavDurationMs(narration.wav) + 300);
  const sessionId = await stop(popup);
  await collect(popup, downloadsDir, sessionId, performed);
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      // keep cleaning up
    }
  }
}

/** Serves transformers.js' model cache (as playwright.config.ts does) to the e2e build. */
function serveModel() {
  const fromTranscribe = createRequire(path.join(REPO_ROOT, "packages", "transcribe", "package.json"));
  const cacheDir = path.join(path.dirname(fromTranscribe.resolve("@huggingface/transformers")), "..", ".cache");
  if (!existsSync(path.join(cacheDir, MODEL_ID, "onnx", "encoder_model.onnx"))) {
    throw new Error(`${MODEL_ID} is not in ${cacheDir}: run "node dev/scripts/download-model.mjs"`);
  }
  const httpServer = path.join(REPO_ROOT, "node_modules", "http-server", "bin", "http-server");
  // --cors: the offscreen document is cross-origin isolated, so the model needs CORS headers.
  const child = spawn(process.execPath, [httpServer, cacheDir, "-p", String(MODEL_PORT), "-a", "127.0.0.1", "--cors", "-c-1", "-s"], {
    stdio: "ignore",
    windowsHide: true,
  });
  lowerPriority(child.pid);
  return () => killTree(child.pid);
}

/** Headless, muted, fake microphone = the narration, downloads into a temporary folder only. */
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
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--mute-audio",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${narration.wav}`,
    ],
  });
  // Same guard as dev/e2e/support/fixtures.ts: hand downloads back to Chrome only after proving the
  // profile saves into the temporary folder, never into the user's Downloads.
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

async function recorderState(popup) {
  const { recorder } = await popup.evaluate(() => chrome.storage.session.get("recorder"));
  return recorder ?? { status: "idle" };
}

async function waitForStatus(popup, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await recorderState(popup);
    if (state.status === status) return state;
    if (Date.now() > deadline) throw new Error(`recorder still "${state.status}" after ${timeoutMs} ms (waiting for "${status}")`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Presses Record and returns t0, the recorder's own clock origin. */
async function start(popup) {
  await popup.bringToFront();
  await popup.locator(TOGGLE).click();
  const state = await waitForStatus(popup, "recording", 15_000);
  if (state.t0 === undefined) throw new Error("recording without t0");
  return state.t0;
}

/** Presses Stop and waits until the session is transcribed, rendered and saved. */
async function stop(popup) {
  // A background tab gets no animation frames and the click would wait for them.
  await popup.bringToFront();
  await popup.locator(TOGGLE).click();
  const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  if (state.error) throw new Error(`the extension failed: ${JSON.stringify(state.error)}`);
  if (!state.lastSessionId) throw new Error("stopped without a saved session");
  return state.lastSessionId;
}

/**
 * Scrolls the element into view and measures it ahead of time, so the timed part is only the
 * press itself; then points (Alt+click at its center) or selects its text (drag across it).
 */
async function perform(page, g, t0) {
  const at = t0 + g.atMs;
  const target = page.locator(g.target).first();
  await target.scrollIntoViewIfNeeded();
  const lead = at - Date.now();
  if (lead < MIN_LEAD_MS) console.warn(`late: "${g.word}" #${g.occurrence ?? 1} prepared only ${lead} ms before its word`);
  if (g.gesture === "select") {
    const box = await target.evaluate((el) => {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, midY: r.top + r.height / 2 };
    });
    await page.mouse.move(box.left + 1, box.midY);
    await sleepUntil(at);
    const pressedAt = Date.now();
    await page.mouse.down();
    await page.mouse.move(box.right - 1, box.midY, { steps: 5 });
    await page.mouse.up();
    return { ...g, plannedMs: g.atMs, pressedMs: pressedAt - t0 };
  }
  const box = await target.boundingBox();
  if (!box) throw new Error(`${g.target} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  // Playwright applies held modifiers to mouse events: pointer, mouse and click all carry altKey.
  await page.keyboard.down("Alt");
  try {
    await sleepUntil(at);
    const pressedAt = Date.now();
    await page.mouse.click(x, y);
    return { ...g, plannedMs: g.atMs, pressedMs: pressedAt - t0 };
  } finally {
    await page.keyboard.up("Alt");
  }
}

/** Copies the saved session out of the temporary downloads folder into dev/eval/.runs/sessions/<app>/. */
async function collect(popup, downloadsDir, sessionId, performed) {
  const folder = path.join(downloadsDir, "pointcast", sessionId);
  if (!existsSync(path.join(folder, "session.json"))) throw new Error(`no session.json in ${folder}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(folder, outDir, { recursive: true });
  // What the extension put on the "clipboard" (recorded, not performed, by the e2e build).
  const { e2eRecords = [] } = await popup.evaluate(() => chrome.storage.session.get("e2eRecords"));
  const copied = e2eRecords.filter((r) => r.kind === "clipboard").at(-1);
  if (copied) writeFileSync(path.join(outDir, "clipboard.md"), copied.text);
  writeFileSync(path.join(outDir, "gestures.json"), `${JSON.stringify(performed, null, 2)}\n`);
  const session = JSON.parse(readFileSync(path.join(outDir, "session.json"), "utf8"));
  console.log(`${appName}: session ${sessionId}, ${session.events.length} events (planned ${gestures.length}) -> ${outDir}`);
  for (const p of performed) console.log(`  ${p.gesture} on "${p.word}": planned ${p.plannedMs} ms, pressed ${p.pressedMs} ms`);
}

/** Duration of a 16-bit mono PCM WAV (what dev/scripts/tts/generate.ps1 writes). */
function wavDurationMs(file) {
  const bytes = readFileSync(file);
  const rate = bytes.readUInt32LE(24);
  const dataStart = bytes.indexOf("data", 12) + 8;
  return ((bytes.length - dataStart) / 2 / rate) * 1000;
}

async function sleepUntil(epochMs) {
  const wait = epochMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
