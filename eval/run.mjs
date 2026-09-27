// Runs the agent under test on every app × condition × repeat and saves each raw JSON result.
//
//   node eval/run.mjs [--apps a,b] [--conditions P-classic,P-requests,M1,M2] [--repeats 3]
//                     [--parallel 4] [--model sonnet] [--effort medium] [--out <dir>]
//
// Conditions (the same task prompt, eval/prompt.md, with a different request inside):
//   P-classic   pointcast's classic session.md          ┐ both rendered here by the CLI from the
//   P-requests  pointcast's "requests" format            ┘ recorded session.json + words.json
//   M1          the same words, without pointing (the session's transcript)
//   M2          a careful written description (eval/scenarios/<app>/M2.md)
// Sessions come from eval/.runs/sessions/<app>/ (eval/record.mjs, or a copy for the pilot).
//
// Each run is `claude -p` with read-only tools only, in the app's folder, isolated from the
// user's own Claude setup as far as the CLI allows (see claudeArgs). Results land in
// <out>/<app>/<condition>/r<k>.json; an existing result is kept, so re-running the same --out
// only does what is missing. Grade with: node eval/grade.mjs <out>
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { APPS_DIR, EVAL_DIR, REPO_ROOT, RUNS_DIR, SCENARIOS_DIR, lowerPriority, readApps, readScenario } from "./lib/apps.mjs";

const CONDITIONS = ["P-classic", "P-requests", "M1", "M2"];
const { values } = parseArgs({
  options: {
    apps: { type: "string", default: readApps().map((a) => a.name).join(",") },
    conditions: { type: "string", default: CONDITIONS.join(",") },
    repeats: { type: "string", default: "3" },
    parallel: { type: "string", default: "4" },
    model: { type: "string", default: "sonnet" },
    effort: { type: "string", default: "medium" },
    out: { type: "string" },
  },
});
const apps = values.apps.split(",");
const conditions = values.conditions.split(",");
for (const c of conditions) if (!CONDITIONS.includes(c)) throw new Error(`unknown condition "${c}"`);
const repeats = Number(values.repeats);
// At most 4 agents at once: API rate limits, and the user is working on this machine.
const parallel = Math.min(Number(values.parallel), 4);
const outDir = path.resolve(values.out ?? path.join(RUNS_DIR, stamp()));

/** The answer shape, enforced by the CLI (--json-schema) and read back by eval/grade.mjs. */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          request: { type: "string" },
          file: { type: "string" },
          line: { type: "integer" },
          target: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["request", "file", "line", "target", "confidence"],
      },
    },
  },
  required: ["changes"],
};

const claudeBin = findClaude();
const jobs = [];
for (const app of apps) {
  const scenario = readScenario(app);
  const cwd = scenario.appDir ? path.join(REPO_ROOT, scenario.appDir) : path.join(APPS_DIR, app);
  if (!existsSync(cwd)) throw new Error(`${app}: ${cwd} does not exist (run eval/setup-apps.mjs)`);
  for (const condition of conditions) {
    const dir = path.join(outDir, app, condition);
    mkdirSync(dir, { recursive: true });
    const prompt = readFileSync(path.join(EVAL_DIR, "prompt.md"), "utf8").replace("{{REQUEST}}", request(app, condition).trim());
    writeFileSync(path.join(dir, "prompt.md"), prompt);
    for (let k = 1; k <= repeats; k++) jobs.push({ app, condition, k, cwd, dir, prompt });
  }
}
// Round-robin over repeats first, so a transient API problem does not hit one condition only.
jobs.sort((a, b) => a.k - b.k);

console.log(`${jobs.length} runs, ${parallel} at a time, model ${values.model} -> ${outDir}`);
let next = 0;
await Promise.all(Array.from({ length: parallel }, async () => {
  while (next < jobs.length) await runJob(/** @type {any} */ (jobs[next++]));
}));
console.log(`done. Grade with: node eval/grade.mjs "${outDir}"`);

/** The user's request as each condition presents it. */
function request(app, condition) {
  const sessionDir = path.join(RUNS_DIR, "sessions", app);
  switch (condition) {
    case "P-classic":
      return render(sessionDir, "classic");
    case "P-requests":
      return render(sessionDir, "requests");
    case "M1": {
      // The transcript P is built from, so M1 differs from P only by the pointing.
      const words = JSON.parse(readFileSync(path.join(sessionDir, "words.json"), "utf8")).words;
      return words.map((w) => w.text).join("").replace(/\s+/g, " ");
    }
    case "M2":
      return readFileSync(path.join(SCENARIOS_DIR, app, "M2.md"), "utf8");
    default:
      throw new Error(condition);
  }
}

/**
 * Renders the session with the CLI (from source, via tsx): both formats come from the same
 * session.json + words.json and the same renderer version. --stdout never writes session.md
 * and never touches the clipboard.
 */
function render(sessionDir, format) {
  if (!existsSync(path.join(sessionDir, "words.json"))) throw new Error(`no recorded session in ${sessionDir}`);
  const tsx = path.join(REPO_ROOT, "packages", "cli", "node_modules", "tsx", "dist", "cli.mjs");
  const cli = path.join(REPO_ROOT, "packages", "cli", "src", "index.ts");
  const res = spawnSync(process.execPath, [tsx, cli, "process", sessionDir, "--format", format, "--stdout", "--no-copy"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  if (res.status !== 0 || !res.stdout.trim()) throw new Error(`pointcast process --format ${format} failed:\n${res.stderr}`);
  return res.stdout;
}

/**
 * Read-only and isolated:
 * - --tools limits the built-in tools to Read, Grep and Glob; nothing else exists in the session.
 * - --setting-sources "" skips user/project/local settings (so no user plugins, hooks or
 *   permissions); --safe-mode also disables CLAUDE.md, skills, plugins, hooks and MCP servers;
 *   --strict-mcp-config with no --mcp-config loads no MCP server at all.
 * - --no-session-persistence writes no transcript into ~/.claude; nothing there is edited.
 * - --permission-mode dontAsk denies anything not allowed instead of waiting for a prompt.
 * (--bare would isolate more but accepts only ANTHROPIC_API_KEY auth, not a subscription login.)
 */
function claudeArgs() {
  return [
    "-p",
    "--output-format", "json",
    "--model", values.model,
    "--effort", values.effort,
    "--json-schema", JSON.stringify(ANSWER_SCHEMA),
    "--tools", "Read,Grep,Glob",
    "--allowedTools", "Read,Grep,Glob",
    "--permission-mode", "dontAsk",
    "--setting-sources", "",
    "--safe-mode",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-chrome",
    "--no-session-persistence",
    "--max-budget-usd", "3",
  ];
}

/** This process may itself run inside Claude Code: drop that session's variables. */
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|AI_AGENT$|BAGGAGE$)/.test(k)));
}

async function runJob(job) {
  const file = path.join(job.dir, `r${job.k}.json`);
  if (existsSync(file)) return;
  const started = Date.now();
  const { code, stdout, stderr } = await new Promise((resolve) => {
    const child = spawn(claudeBin, claudeArgs(), { cwd: job.cwd, env: cleanEnv(), windowsHide: true });
    lowerPriority(child.pid);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 20 * 60_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ code: c, stdout: out, stderr: err });
    });
    child.stdin.end(job.prompt);
  });
  const secs = Math.round((Date.now() - started) / 1000);
  try {
    const result = JSON.parse(stdout);
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${job.app} ${job.condition} r${job.k}: ${result.is_error ? "ERROR" : "ok"} in ${secs} s, $${result.total_cost_usd?.toFixed(3)}`);
  } catch {
    // Not saved as r<k>.json, so the next invocation with the same --out retries it.
    writeFileSync(path.join(job.dir, `r${job.k}.error.txt`), `exit ${code}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`);
    console.log(`${job.app} ${job.condition} r${job.k}: FAILED (exit ${code}) in ${secs} s, see r${job.k}.error.txt`);
  }
}

/** The claude executable itself (the npm .cmd shim cannot be spawned without a shell on Windows). */
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidates =
      process.platform === "win32"
        ? [path.join(dir, "claude.exe"), path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]
        : [path.join(dir, "claude")];
    const found = candidates.find((c) => existsSync(c));
    if (found) return found;
  }
  throw new Error("claude not found on PATH (set CLAUDE_BIN)");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
