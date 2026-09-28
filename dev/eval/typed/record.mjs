// Records every task of dev/eval/typed/tasks.json with the real extension in TYPED mode (D12):
// headless Chromium, muted, the e2e build; per task: Record, one Alt+click (or text selection),
// type the note into Pointcast's note box, Enter, Stop. No microphone, no speech model.
//
//   node dev/eval/typed/record.mjs --out <dir> [--apps a,b] [--tasks id,id]
//        [--django-dir <locallibrary checkout> --python <venv python> --django-pythonpath <dir>]
//
// Output per task, in <out>/sessions/<app>/<task>/<session id>/: the files the extension saved
// (session.json, session.md), plus <out>/sessions/<app>/<task>/clipboard.md (what the e2e build
// recorded instead of writing the clipboard) and screenshot.png (the page with the element
// outlined, taken AFTER Stop, for variant A's writer).
//
// Safety: the popup's "Send to your agent's MCP server" (handoff) is turned OFF, so the extension
// never contacts any port (the e2e build's handoff port, 5542, is also shadcn-admin's Vite port);
// sessions go through chrome.downloads into a temporary folder checked before recording.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { REPO_ROOT, appByName, killTree, lowerPriority, startDevServer } from "../lib/apps.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    apps: { type: "string" },
    tasks: { type: "string" },
    extension: { type: "string" },
    "django-dir": { type: "string", default: process.env.EVAL_DJANGO_DIR },
    python: { type: "string", default: process.env.EVAL_DJANGO_PYTHON },
    "django-pythonpath": { type: "string", default: process.env.EVAL_DJANGO_PYTHONPATH },
  },
});
if (!values.out) throw new Error("--out <dir> is required");
const OUT = path.resolve(values.out);
const EXTENSION_DIR = values.extension ? path.resolve(values.extension) : path.join(REPO_ROOT, "packages", "extension", ".output", "chrome-mv3-e2e");
if (!existsSync(path.join(EXTENSION_DIR, "manifest.json"))) throw new Error(`no extension build at ${EXTENSION_DIR}`);

const config = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const wantedApps = values.apps?.split(",");
const wantedTasks = values.tasks?.split(",");
const tasks = config.tasks.filter((t) => (!wantedApps || wantedApps.includes(t.app)) && (!wantedTasks || wantedTasks.includes(t.id)));
const NOTE_BOX = '[data-pointcast-ui="note"]';

for (const appName of [...new Set(tasks.map((t) => t.app))]) {
  const cleanup = [];
  try {
    const server = config.apps[appName].server === "django" ? await startDjango(config.apps[appName]) : await startDevServer(appByName(appName));
    cleanup.push(server.stop);
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pointcast-typed-eval-"));
    cleanup.push(() => rmSync(tempDir, { recursive: true, force: true }));
    const downloadsDir = path.join(tempDir, "downloads");
    const context = await launch(tempDir, downloadsDir);
    cleanup.push(() => context.close());
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.evaluate(() =>
      chrome.storage.local.set({ settings: { language: "es", keepAudio: false, notify: false, handoff: false, inputMode: "typed" } }),
    );
    await popup.reload();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const task of tasks.filter((t) => t.app === appName)) await recordTask(task, server.url, popup, page, downloadsDir);
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {
        // keep cleaning up
      }
    }
  }
}

async function recordTask(task, baseUrl, popup, page, downloadsDir) {
  const dir = path.join(OUT, "sessions", task.app, task.id);
  if (existsSync(path.join(dir, "result.json"))) return console.log(`${task.app}/${task.id}: already recorded`);
  await page.goto(`${baseUrl}${task.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500); // charts and late layout settle
  const target = page.locator(task.target).first();
  await target.scrollIntoViewIfNeeded();
  const expectedText = (await target.innerText()).trim();

  await popup.bringToFront();
  await popup.locator("#toggle").click();
  await waitForStatus(popup, "recording", 15_000);
  await page.bringToFront();
  await page.locator("[data-pointcast-ui] .rec").waitFor({ state: "visible", timeout: 15_000 });

  if (task.gesture === "select") {
    const box = await target.evaluate((el) => {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, midY: r.top + r.height / 2 };
    });
    await page.mouse.move(box.left + 1, box.midY);
    await page.mouse.down();
    await page.mouse.move(box.right - 1, box.midY, { steps: 6 });
    await page.mouse.up();
  } else {
    const box = await target.boundingBox();
    if (!box) throw new Error(`${task.id}: ${task.target} has no box`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Alt");
    try {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } finally {
      await page.keyboard.up("Alt");
    }
  }
  await waitFor(async () => page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, NOTE_BOX), 10_000, "note box focused");
  await page.keyboard.type(task.note, { delay: 15 });
  await page.keyboard.press("Enter");
  await waitFor(async () => (await page.locator(NOTE_BOX).count()) === 0, 5_000, "note box closed");
  await waitFor(async () => ((await popup.evaluate(() => chrome.storage.session.get("eventCount"))).eventCount ?? 0) === 1, 5_000, "one event");

  await popup.bringToFront();
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "idle", 60_000);
  if (state.error) throw new Error(`${task.id}: the extension failed: ${JSON.stringify(state.error)}`);
  const sessionId = state.lastSessionId;
  const folder = path.join(downloadsDir, "pointcast", sessionId);
  if (!existsSync(path.join(folder, "session.json"))) throw new Error(`${task.id}: no session.json in ${folder}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(folder, path.join(dir, sessionId), { recursive: true });
  const { e2eRecords = [] } = await popup.evaluate(() => chrome.storage.session.get("e2eRecords"));
  const copied = e2eRecords.filter((r) => r.kind === "clipboard").at(-1);
  if (copied) writeFileSync(path.join(dir, "clipboard.md"), copied.text);

  // The screenshot for variant A's writer: the same page, the element outlined (after Stop).
  await page.bringToFront();
  await target.evaluate((el) => {
    el.style.outline = "3px solid red";
    el.style.outlineOffset = "2px";
  });
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir, "screenshot.png") });
  await target.evaluate((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  });

  const session = JSON.parse(readFileSync(path.join(dir, sessionId, "session.json"), "utf8"));
  const ev = session.events[0];
  const summary = {
    task: task.id,
    sessionId,
    inputMode: session.inputMode,
    events: session.events.length,
    expectedText,
    capturedText: ev?.element?.text,
    tag: ev?.element?.tag,
    note: ev?.note,
    component: ev?.element?.component,
    renderedBy: ev?.element?.renderedBy,
    resolved: ev?.element?.resolved,
    lastResultCode: state.lastResult?.code,
  };
  writeFileSync(path.join(dir, "result.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${task.app}/${task.id}: session ${sessionId}, ${session.events.length} event(s), «${ev?.element?.text?.slice(0, 40)}» (expected «${expectedText.slice(0, 40)}»), renderedBy ${ev?.element?.renderedBy?.length ?? 0} frame(s), resolved ${ev?.element?.resolved?.length ?? 0}`);
}

/** `manage.py runserver` of the locallibrary checkout, with the evaluation settings (outside the app). */
async function startDjango(app) {
  const dir = values["django-dir"];
  const python = values.python;
  if (!dir || !python || !values["django-pythonpath"]) throw new Error("locallibrary needs --django-dir, --python and --django-pythonpath");
  const url = `http://127.0.0.1:${app.port}`;
  const child = spawn(python, ["manage.py", "runserver", `127.0.0.1:${app.port}`, "--noreload"], {
    cwd: dir,
    env: {
      ...process.env,
      DJANGO_SETTINGS_MODULE: "pointcast_eval_settings",
      PYTHONPATH: [values["django-pythonpath"], dir].join(path.delimiter),
      PYTHONDONTWRITEBYTECODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  lowerPriority(child.pid);
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const stop = () => killTree(child.pid);
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`runserver exited:\n${log}`);
      try {
        return (await fetch(`${url}/catalog/`)).ok;
      } catch {
        return false;
      }
    }, 60_000, "django runserver");
  } catch (error) {
    stop();
    throw error;
  }
  return { url, stop };
}

/** Headless, muted, downloads into a temporary folder only (the check of dev/eval/record.mjs). */
async function launch(tempDir, downloadsDir) {
  const userDataDir = path.join(tempDir, "profile");
  mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });
  writeFileSync(path.join(userDataDir, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, "--mute-audio"],
  });
  const settings = await context.newPage();
  await settings.goto("chrome://settings/downloads");
  const shown = await settings.evaluate(async () => String((await chrome.settingsPrivate.getPref("download.default_directory")).value));
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

async function waitForStatus(popup, status, timeoutMs) {
  let state;
  await waitFor(async () => {
    state = (await popup.evaluate(() => chrome.storage.session.get("recorder"))).recorder ?? { status: "idle" };
    return state.status === status;
  }, timeoutMs, `recorder "${status}"`);
  return state;
}

async function waitFor(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
