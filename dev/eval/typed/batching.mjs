// Batching follow-up: does one recording with several changes save work against asking one by one
// or two by two? Per app a set of 6 changes (batching.json), delivered as 1-by-1 (6 runs), 2-by-2
// (3 runs) and all-6 (1 run), in variants A (hand-typed, independent writer) and C (Pointcast
// through the MCP server).
//
//   node dev/eval/typed/batching.mjs record  --out <dir> --first <first eval dir> --django-dir … --python … --django-pythonpath …
//   node dev/eval/typed/batching.mjs prepare --out <dir> --first <first eval dir> --django-dir …
//   node dev/eval/typed/batching.mjs write-a --out <dir> --first <first eval dir>
//   node dev/eval/typed/batching.mjs run     --out <dir> --first <first eval dir> --django-dir … --repeat <k>
//   node dev/eval/typed/batching.mjs grade   --out <dir> --first <first eval dir>
//
// Units: "g1-<task>" (one change), "g2-<n>" (the set's pairs 1-2, 3-4, 5-6), "g6" (all six).
// The 1-by-1 cells of the 16 tasks of the first evaluation are that evaluation's runs r1..r3
// (same prompts, recordings, settings and day); only the new tasks get new 1-by-1 runs.
// A unit's recording is ONE typed session holding exactly its changes, made with the extension
// (e2e build, headless, handoff off), gestures in set order, navigating when the page changes.
// The ledger of this follow-up is <out>/ledger.jsonl; no run starts once it reaches 7.5 USD.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { APPS_DIR, EVAL_DIR, REPO_ROOT, appByName, killTree, lowerPriority, startDevServer } from "../lib/apps.mjs";
import { extractAnswer, gradeAnswer, isRight } from "../grade.mjs";
import { runClaude, spentUsd } from "./claude.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    out: { type: "string" },
    first: { type: "string" },
    repeat: { type: "string", default: "1" },
    parallel: { type: "string", default: "4" },
    variants: { type: "string", default: "A,C" },
    "django-dir": { type: "string", default: process.env.EVAL_DJANGO_DIR },
    python: { type: "string", default: process.env.EVAL_DJANGO_PYTHON },
    "django-pythonpath": { type: "string", default: process.env.EVAL_DJANGO_PYTHONPATH },
  },
});
if (!values.out || !values.first) throw new Error("--out and --first are required");
const OUT = path.resolve(values.out);
const FIRST = path.resolve(values.first);
const STOP_BEFORE_USD = 7.5;
mkdirSync(OUT, { recursive: true });

const base = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const batching = JSON.parse(readFileSync(path.join(TYPED_DIR, "batching.json"), "utf8"));
const TASKS = Object.fromEntries([...base.tasks, ...batching.tasks].map((t) => [t.id, { ...t, topic: batching.topics[t.id] }]));
const NEW = new Set(batching.tasks.map((t) => t.id));
const APPS = base.apps;

/** Every unit of every set: which tasks, and whether its runs come from the first evaluation. */
function units() {
  const list = [];
  for (const [app, ids] of Object.entries(batching.sets)) {
    for (const id of ids) list.push({ app, id: `g1-${id}`, g: 1, tasks: [id], reused: !NEW.has(id) });
    for (let i = 0; i < 3; i++) list.push({ app, id: `g2-${i + 1}`, g: 2, tasks: ids.slice(2 * i, 2 * i + 2), reused: false });
    list.push({ app, id: "g6", g: 6, tasks: [...ids], reused: false });
  }
  return list;
}
const unitDir = (u) => (u.reused ? path.join(FIRST, u.app, u.tasks[0]) : path.join(OUT, u.app, u.id));
const appDir = (app) => (APPS[app].server === "django" ? path.resolve(values["django-dir"]) : path.join(APPS_DIR, app));
const screenshotOf = (id) => (NEW.has(id) ? path.join(OUT, "sessions", TASKS[id].app, `g1-${id}`, "screenshot.png") : path.join(FIRST, "sessions", TASKS[id].app, id, "screenshot.png"));

// The command runs at the end of the file, once every constant below is initialized.

// ---------------------------------------------------------------- record

async function record() {
  const EXTENSION_DIR = path.join(REPO_ROOT, "packages", "extension", ".output", "chrome-mv3-e2e");
  const todo = units().filter((u) => !u.reused);
  for (const app of Object.keys(batching.sets)) {
    const mine = todo.filter((u) => u.app === app && !existsSync(path.join(OUT, "sessions", app, u.id, "result.json")));
    if (!mine.length) continue;
    const cleanup = [];
    try {
      const server = APPS[app].server === "django" ? await startDjango(APPS[app]) : await startDevServer(appByName(app));
      cleanup.push(server.stop);
      const tempDir = mkdtempSync(path.join(os.tmpdir(), "pointcast-batching-"));
      cleanup.push(() => rmSync(tempDir, { recursive: true, force: true }));
      const downloadsDir = path.join(tempDir, "downloads");
      const context = await launch(EXTENSION_DIR, tempDir, downloadsDir);
      cleanup.push(() => context.close());
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
      await popup.evaluate(() => chrome.storage.local.set({ settings: { language: "es", keepAudio: false, notify: false, handoff: false, inputMode: "typed" } }));
      await popup.reload();
      const page = await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const u of mine) await recordUnit(u, server.url, popup, page, downloadsDir);
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
}

async function recordUnit(u, baseUrl, popup, page, downloadsDir) {
  const dir = path.join(OUT, "sessions", u.app, u.id);
  const first = TASKS[u.tasks[0]];
  await page.goto(`${baseUrl}${first.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await popup.bringToFront();
  await popup.locator("#toggle").click();
  await waitForStatus(popup, "recording", 15_000);
  await page.bringToFront();
  let current = first.path;
  const expected = [];
  for (const [i, id] of u.tasks.entries()) {
    const task = TASKS[id];
    if (task.path !== current) {
      await page.goto(`${baseUrl}${task.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      current = task.path;
    }
    await page.locator("[data-pointcast-ui] .rec").waitFor({ state: "visible", timeout: 15_000 });
    const target = page.locator(task.target).first();
    await target.scrollIntoViewIfNeeded();
    expected.push((await target.innerText()).trim());
    await gesture(page, task, target);
    await waitFor(async () => page.evaluate(() => document.activeElement?.matches('[data-pointcast-ui="note"]') ?? false), 10_000, "note box focused");
    await page.keyboard.type(task.note, { delay: 15 });
    await page.keyboard.press("Enter");
    await waitFor(async () => (await page.locator('[data-pointcast-ui="note"]').count()) === 0, 5_000, "note box closed");
    await waitFor(async () => ((await popup.evaluate(() => chrome.storage.session.get("eventCount"))).eventCount ?? 0) === i + 1, 5_000, `${i + 1} events`);
    if (u.g === 1) {
      // The screenshot for A's writer (one-change units only; batches reuse them).
      await target.evaluate((el) => {
        el.style.outline = "3px solid red";
        el.style.outlineOffset = "2px";
      });
      await page.screenshot({ path: path.join(OUT, "tmp-shot.png") });
      await target.evaluate((el) => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      });
    }
  }
  await popup.bringToFront();
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "idle", 60_000);
  if (state.error) throw new Error(`${u.app}/${u.id}: the extension failed: ${JSON.stringify(state.error)}`);
  const sessionId = state.lastSessionId;
  const folder = path.join(downloadsDir, "pointcast", sessionId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(folder, path.join(dir, sessionId), { recursive: true });
  if (u.g === 1) copyFileSync(path.join(OUT, "tmp-shot.png"), path.join(dir, "screenshot.png"));
  const session = JSON.parse(readFileSync(path.join(dir, sessionId, "session.json"), "utf8"));
  const got = session.events.map((e) => e.element?.text);
  const summary = { unit: u.id, tasks: u.tasks, sessionId, events: session.events.length, expected, captured: got, notes: session.events.map((e) => e.note) };
  writeFileSync(path.join(dir, "result.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const ok = session.events.length === u.tasks.length && got.every((t, i) => fold(t).trim() === fold(expected[i]).trim() || fold(expected[i]).includes(fold(t).trim()));
  console.log(`${u.app}/${u.id}: ${session.events.length}/${u.tasks.length} events ${ok ? "ok" : "CHECK"} ${JSON.stringify(got)}`);
}

async function gesture(page, task, target) {
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
    return;
  }
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

async function startDjango(app) {
  const dir = values["django-dir"];
  const url = `http://127.0.0.1:${app.port}`;
  const child = spawn(values.python, ["manage.py", "runserver", `127.0.0.1:${app.port}`, "--noreload"], {
    cwd: dir,
    env: { ...process.env, DJANGO_SETTINGS_MODULE: "pointcast_eval_settings", PYTHONPATH: [values["django-pythonpath"], dir].join(path.delimiter), PYTHONDONTWRITEBYTECODE: "1" },
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

async function launch(extensionDir, tempDir, downloadsDir) {
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
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--mute-audio"],
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

function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- prepare (C configs and prompts)

const C_REQUEST = `The user recorded this request with pointcast. Get it with the pointcast MCP tool \`get_session\` (id "latest"), then follow the spec's own rules, written at its top. Each request quotes what the user wrote about the element they pointed at. Find each element through its code pointer before searching:
- \`text at:\` or \`data at:\` is the line that holds that element's text or data: usually the line to change.
- \`used at:\`/\`code:\` is where that instance is written, innermost first; a component marked shared renders every instance: change the instance, not the shared component, unless the request is about all of them.
- Search the codebase only when the spec gives no pointer, and then use its \`find:\` hints.`;

function prepare() {
  const CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");
  const template = readFileSync(path.join(EVAL_DIR, "prompt.md"), "utf8");
  const hashes = [];
  for (const u of units().filter((x) => !x.reused)) {
    const rec = path.join(OUT, "sessions", u.app, u.id);
    const sessionId = readdirSync(rec, { withFileTypes: true }).find((d) => d.isDirectory())?.name;
    if (!sessionId) throw new Error(`${u.app}/${u.id}: not recorded`);
    const sessions = path.join(OUT, "work", "C", u.app, u.id);
    rmSync(sessions, { recursive: true, force: true });
    cpSync(path.join(rec, sessionId), path.join(sessions, sessionId), { recursive: true });
    const cDir = path.join(OUT, u.app, u.id, "C");
    mkdirSync(cDir, { recursive: true });
    const mcp = { mcpServers: { pointcast: { command: process.execPath, args: [CLI, "mcp", "--repo", appDir(u.app), "--dir", sessions, "--no-handoff"] } } };
    writeFileSync(path.join(cDir, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`);
    const res = spawnSync(process.execPath, [CLI, "process", path.join(sessions, sessionId), "--repo", appDir(u.app), "--stdout", "--no-copy"], { cwd: sessions, encoding: "utf8", env: { ...process.env, POINTCAST_HANDOFF: "off" } });
    writeFileSync(path.join(cDir, "get-session.preview.md"), res.stdout ?? "");
    const prompt = template.replace("{{REQUEST}}", C_REQUEST);
    writeFileSync(path.join(cDir, "prompt.md"), prompt);
    hashes.push(`${createHash("sha256").update(prompt).digest("hex")}  ${u.app}/${u.id}/C/prompt.md`);
  }
  writeFileSync(path.join(OUT, "prompts-C.sha256"), `${hashes.join("\n")}\n`);
  console.log(`prepared C for ${hashes.length} units`);
}

// ---------------------------------------------------------------- write-a

const LIMIT = { 1: 40, 2: 65, 6: 150 };
function writerInstruction(tasks) {
  const n = tasks.length;
  const wants = tasks.map((t, i) => (n === 1 ? `What you want: ${t.intent}.` : `Screenshot ${i + 1}: ${t.intent}.`)).join("\n");
  return `You are a developer checking your own web app in the browser. ${n === 1 ? "The attached screenshot shows the page you are looking at; the element outlined in red is the one you want changed" : `The ${n} attached screenshots, in order, show what you looked at; in each one, the element outlined in red is one you want changed`} (the red outline is not part of the app).
${wants}

Now type ${n === 1 ? "that request" : `all ${n} changes as ONE message`} quickly into Claude Code, the coding agent working in this app's repository, as a developer in a hurry would. The agent cannot see your screen or the screenshots, so name each element the way you naturally would from what you see. Write it in Spanish. At most ${LIMIT[n]} words. Do not mention the red outline or the screenshots, and do not invent file names or code you cannot see. Reply with the request text only, nothing else.`;
}

async function writeA() {
  const template = readFileSync(path.join(EVAL_DIR, "prompt.md"), "utf8");
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--effort", "medium", "--tools", "", "--permission-mode", "dontAsk", "--setting-sources", "", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome", "--no-session-persistence", "--max-budget-usd", "1"];
  const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
  const jobs = units().filter((u) => !u.reused);
  const one = async (u) => {
    const dir = path.join(OUT, u.app, u.id, "A");
    if (existsSync(path.join(dir, "prompt.md"))) return;
    mkdirSync(dir, { recursive: true });
    const tasks = u.tasks.map((id) => TASKS[id]);
    const input = writerInstruction(tasks);
    writeFileSync(path.join(dir, "writer.input.md"), input);
    const content = [];
    for (const t of tasks) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(screenshotOf(t.id)).toString("base64") } });
    content.push({ type: "text", text: input });
    const message = `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
    const cwd = path.join(OUT, "work", "A-writer", u.app, u.id);
    mkdirSync(cwd, { recursive: true });
    let best;
    for (let n = 1; n <= 3; n++) {
      const { result } = await runClaude({ args, prompt: message, cwd, streamFile: path.join(dir, `writer-${n}.stream.jsonl`), outDir: OUT, label: `writer ${u.app}/${u.id} #${n}`, stopBeforeUsd: STOP_BEFORE_USD, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
      if (!result || result.is_error) continue;
      const text = String(result.result ?? "").trim().replace(/^["«]|["»]$/g, "");
      writeFileSync(path.join(dir, `writer-${n}.md`), `${text}\n`);
      if (!best || words(text) < words(best)) best = text;
      if (words(text) <= LIMIT[tasks.length]) break;
    }
    if (!best) throw new Error(`${u.id}: no writer output`);
    writeFileSync(path.join(dir, "request.md"), `${best}\n`);
    const prompt = template.replace("{{REQUEST}}", best);
    writeFileSync(path.join(dir, "prompt.md"), prompt);
    writeFileSync(path.join(dir, "prompt.sha256"), `${createHash("sha256").update(prompt).digest("hex")}\n`);
    console.log(`${u.app}/${u.id} (${words(best)} words): ${best}`);
  };
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (jobs.length) await one(jobs.shift());
  }));
  console.log(`writers done; ledger ${spentUsd(OUT).toFixed(3)} USD`);
}

// ---------------------------------------------------------------- run

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: { request: { type: "string" }, file: { type: "string" }, line: { type: "integer" }, target: { type: "string" }, confidence: { type: "number" } },
        required: ["request", "file", "line", "target", "confidence"],
      },
    },
  },
  required: ["changes"],
};
const MCP_TOOLS = ["mcp__pointcast__get_session", "mcp__pointcast__get_element", "mcp__pointcast__list_sessions"];

async function run() {
  const k = Number(values.repeat);
  const variants = values.variants.split(",");
  const jobs = [];
  for (const u of units().filter((x) => !x.reused)) for (const v of variants) jobs.push({ u, v, dir: path.join(OUT, u.app, u.id, v) });
  console.log(`${jobs.length} runs (r${k}); ledger ${spentUsd(OUT).toFixed(3)} USD, stop at ${STOP_BEFORE_USD}`);
  let next = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: Math.min(Number(values.parallel), 4) }, async () => {
    while (next < jobs.length && !stopped) {
      const { u, v, dir } = jobs[next++];
      const file = path.join(dir, `r${k}.json`);
      if (existsSync(file)) continue;
      const c = v === "C";
      const args = [
        "-p", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--effort", "medium",
        "--json-schema", JSON.stringify(ANSWER_SCHEMA),
        "--tools", "Read,Grep,Glob", "--allowedTools", ["Read", "Grep", "Glob", ...(c ? MCP_TOOLS : [])].join(","),
        "--permission-mode", "dontAsk", "--setting-sources", "", "--strict-mcp-config",
        ...(c ? ["--mcp-config", path.join(dir, "mcp.json")] : []),
        "--disable-slash-commands", "--no-chrome", "--no-session-persistence", "--max-budget-usd", "1.5",
      ];
      try {
        const { result, code, stderr, wallMs } = await runClaude({ args, prompt: readFileSync(path.join(dir, "prompt.md"), "utf8"), cwd: appDir(u.app), streamFile: path.join(dir, `r${k}.stream.jsonl`), outDir: OUT, label: `${u.app}/${u.id}/${v}/r${k}`, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }, stopBeforeUsd: STOP_BEFORE_USD });
        if (result) {
          writeFileSync(file, `${JSON.stringify({ ...result, wall_ms: wallMs }, null, 2)}\n`);
          console.log(`${u.app}/${u.id} ${v} r${k}: ${result.is_error ? "ERROR" : "ok"} ${Math.round(wallMs / 1000)} s $${result.total_cost_usd?.toFixed(3)} (total ${spentUsd(OUT).toFixed(2)})`);
        } else {
          writeFileSync(path.join(dir, `r${k}.error.txt`), `exit ${code}\n${stderr}`);
          console.log(`${u.app}/${u.id} ${v} r${k}: FAILED (exit ${code})`);
        }
      } catch (error) {
        console.log(String(error.message));
        stopped = true;
      }
    }
  }));
  console.log(`done; ledger ${spentUsd(OUT).toFixed(3)} USD`);
}

// ---------------------------------------------------------------- grade

function toolCalls(file) {
  const calls = [];
  if (!existsSync(file)) return calls;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "assistant") for (const c of e.message?.content ?? []) if (c.type === "tool_use") calls.push(c.name);
    } catch {
      // not JSON
    }
  }
  return calls;
}

function gradeUnit(u, v, k) {
  const file = path.join(unitDir(u), v, `r${k}.json`);
  if (!existsSync(file)) return undefined;
  const result = JSON.parse(readFileSync(file, "utf8"));
  const items = result.is_error ? undefined : extractAnswer(result);
  const changes = u.tasks.map((id) => ({ id, ...TASKS[id].truth, topic: u.tasks.length === 1 ? "." : TASKS[id].topic }));
  const grades = items ? gradeAnswer(items, changes) : changes.map((c) => ({ id: c.id, status: "no answer", items: [] }));
  const perChange = grades.map((g, i) => {
    const mine = g.items.map((j) => items[j]).sort((a, b) => b.confidence - a.confidence);
    return { id: g.id, status: g.status, why: g.why, firstChoice: mine.length > 0 && isRight(mine[0], changes[i]).ok };
  });
  const calls = toolCalls(file.replace(".json", ".stream.jsonl"));
  const us = result.usage ?? {};
  return {
    app: u.app, unit: u.id, g: u.g, variant: v, run: k, reused: u.reused, perChange, answer: items,
    input: (us.input_tokens ?? 0) + (us.cache_creation_input_tokens ?? 0) + (us.cache_read_input_tokens ?? 0),
    output: us.output_tokens ?? 0, cost: result.total_cost_usd ?? 0, durationS: (result.duration_ms ?? 0) / 1000, wallS: (result.wall_ms ?? 0) / 1000,
    searches: calls.filter((c) => c === "Grep" || c === "Glob").length, toolCalls: calls.length, turns: result.num_turns ?? 0,
  };
}

function grade() {
  const rows = [];
  const all = [];
  for (const [app] of Object.entries(batching.sets))
    for (const v of ["A", "C"])
      for (const g of [1, 2, 6])
        for (let k = 1; k <= 5; k++) {
          const us = units().filter((u) => u.app === app && u.g === g);
          const graded = us.map((u) => gradeUnit(u, v, k));
          if (graded.some((x) => x === undefined)) continue;
          all.push(...graded);
          const changes = graded.flatMap((x) => x.perChange);
          const sum = (f) => graded.reduce((a, x) => a + f(x), 0);
          rows.push({ app, v, g, k, runs: graded.length, correct: changes.filter((c) => c.status === "correct").length, first: changes.filter((c) => c.firstChoice).length, missed: changes.filter((c) => c.status === "missed").length, input: sum((x) => x.input), output: sum((x) => x.output), cost: sum((x) => x.cost), time: sum((x) => x.durationS), searches: sum((x) => x.searches), toolCalls: sum((x) => x.toolCalls), turns: sum((x) => x.turns) });
        }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lines = ["### Per variant and granularity (means over sets × repeats; one set = 6 changes)", "", "| Variant | Changes per run | Sets | Correct (strict) | First choice correct | Missed | Input tokens per set | per change | Output per set | Cost per set (USD) | Time per set (s) | Grep+Glob per set | Tool calls per set |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const v of ["A", "C"])
    for (const g of [1, 2, 6]) {
      const rs = rows.filter((r) => r.v === v && r.g === g);
      if (!rs.length) continue;
      const n = rs.length * 6;
      lines.push(`| ${v} | ${g} | ${rs.length} | ${rs.reduce((a, r) => a + r.correct, 0)}/${n} (${Math.round((100 * rs.reduce((a, r) => a + r.correct, 0)) / n)} %) | ${rs.reduce((a, r) => a + r.first, 0)}/${n} | ${rs.reduce((a, r) => a + r.missed, 0)} | ${(mean(rs.map((r) => r.input)) / 1000).toFixed(1)} k | ${(mean(rs.map((r) => r.input)) / 6000).toFixed(1)} k | ${(mean(rs.map((r) => r.output)) / 1000).toFixed(1)} k | ${mean(rs.map((r) => r.cost)).toFixed(3)} | ${mean(rs.map((r) => r.time)).toFixed(0)} | ${mean(rs.map((r) => r.searches)).toFixed(1)} | ${mean(rs.map((r) => r.toolCalls)).toFixed(1)} |`);
    }
  lines.push("", "### Per app (correct/6 per repeat; input tokens per set; Grep+Glob per set)", "", "| App | Variant | 1-by-1 | 2-by-2 | all-6 |", "|---|---|---|---|---|");
  for (const app of Object.keys(batching.sets))
    for (const v of ["A", "C"]) {
      const cell = (g) => rows.filter((r) => r.app === app && r.v === v && r.g === g).map((r) => `${r.correct}/6 · ${(r.input / 1000).toFixed(0)} k · ${r.searches}`).join("<br>") || "–";
      lines.push(`| ${app} | ${v} | ${cell(1)} | ${cell(2)} | ${cell(6)} |`);
    }
  lines.push("", "### Per change (correct of repeats: 1-by-1 / 2-by-2 / all-6)", "", "| App | Change | A | C |", "|---|---|---|---|");
  for (const [app, ids] of Object.entries(batching.sets))
    for (const id of ids) {
      const cell = (v) => [1, 2, 6].map((g) => { const cs = all.filter((x) => x.app === app && x.variant === v && x.g === g).flatMap((x) => x.perChange).filter((c) => c.id === id); return `${cs.filter((c) => c.status === "correct").length}/${cs.length}`; }).join(" / ");
      lines.push(`| ${app} | ${id} | ${cell("A")} | ${cell("C")} |`);
    }
  lines.push("", "### Failures", "");
  for (const x of all) for (const c of x.perChange) if (c.status !== "correct") lines.push(`- ${x.app} ${x.unit} ${x.variant} r${x.run}: ${c.id} ${c.status}${c.firstChoice ? " (first choice right)" : ""}: ${c.why ?? ""}`);
  writeFileSync(path.join(OUT, "grades.json"), `${JSON.stringify({ rows, runs: all }, null, 2)}\n`);
  writeFileSync(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------- main

const COMMANDS = { record, prepare, "write-a": writeA, run, grade };
if (!COMMANDS[command]) throw new Error(`unknown command "${command}"`);
await COMMANDS[command]();
