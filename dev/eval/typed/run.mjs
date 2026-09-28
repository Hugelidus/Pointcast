// Runs the agent under test on every task × variant (A, B, C) × repeat of the typed evaluation.
//
//   node dev/eval/typed/run.mjs --out <dir> --django-dir <locallibrary> [--repeat 1] [--parallel 4]
//        [--variants A,B,C] [--tasks id,…]
//
// Same agent settings as dev/eval/run.mjs and Stage 0 (Sonnet, medium effort, tools Read, Grep and
// Glob only, --setting-sources "", --strict-mcp-config, no session persistence, the same task
// prompt and answer schema, stream-json so every tool call is logged), with ONE deliberate change:
// --safe-mode is off for every variant, because it also disables MCP, and variant C needs the
// pointcast MCP server. To keep the three variants identical, auto memory is disabled through the
// environment (CLAUDE_CODE_DISABLE_AUTO_MEMORY=1); no CLAUDE.md exists in the apps or above them.
// Variant C alone gets --mcp-config <dir>/<app>/<task>/C/mcp.json (node packages/cli/dist/index.js
// mcp --repo <app> --dir <that task's sessions> --no-handoff) and the server's three tools.
//
// Results: <dir>/<app>/<task>/<variant>/r<k>.json (the final result event, what
// --output-format json prints) and r<k>.stream.jsonl (every event). Existing results are kept.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { APPS_DIR } from "../lib/apps.mjs";
import { runClaude, spentUsd, STOP_BEFORE_USD } from "./claude.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    "django-dir": { type: "string", default: process.env.EVAL_DJANGO_DIR },
    repeat: { type: "string", default: "1" },
    parallel: { type: "string", default: "4" },
    variants: { type: "string", default: "A,B,C" },
    tasks: { type: "string" },
  },
});
if (!values.out) throw new Error("--out <dir> is required");
const OUT = path.resolve(values.out);
const config = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const k = Number(values.repeat);

export const ANSWER_SCHEMA = {
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
const MCP_TOOLS = ["mcp__pointcast__get_session", "mcp__pointcast__get_element", "mcp__pointcast__list_sessions"];

function argsFor(variant, taskDir) {
  const c = variant === "C";
  return [
    "-p",
    "--output-format", "stream-json", "--verbose",
    "--model", "sonnet",
    "--effort", "medium",
    "--json-schema", JSON.stringify(ANSWER_SCHEMA),
    "--tools", "Read,Grep,Glob",
    "--allowedTools", ["Read", "Grep", "Glob", ...(c ? MCP_TOOLS : [])].join(","),
    "--permission-mode", "dontAsk",
    "--setting-sources", "",
    "--strict-mcp-config",
    ...(c ? ["--mcp-config", path.join(taskDir, "C", "mcp.json")] : []),
    "--disable-slash-commands",
    "--no-chrome",
    "--no-session-persistence",
    "--max-budget-usd", "1",
  ];
}

const appDir = (app) => (config.apps[app].server === "django" ? path.resolve(values["django-dir"]) : path.join(APPS_DIR, app));
const variants = values.variants.split(",");
const wanted = values.tasks?.split(",");
const jobs = [];
for (const variant of variants)
  for (const task of config.tasks) {
    if (wanted && !wanted.includes(task.id)) continue;
    const taskDir = path.join(OUT, task.app, task.id);
    jobs.push({ task, variant, taskDir, dir: path.join(taskDir, variant) });
  }
// Interleave variants so a transient API problem or machine load does not hit one variant only.
jobs.sort((a, b) => config.tasks.indexOf(a.task) - config.tasks.indexOf(b.task) || a.variant.localeCompare(b.variant));

console.log(`${jobs.length} runs (repeat r${k}), ${values.parallel} at a time; spent so far ${spentUsd(OUT).toFixed(3)} USD, stop at ${STOP_BEFORE_USD}`);
let next = 0;
let stopped = false;
await Promise.all(Array.from({ length: Math.min(Number(values.parallel), 4) }, async () => {
  while (next < jobs.length && !stopped) {
    const job = jobs[next++];
    const file = path.join(job.dir, `r${k}.json`);
    if (existsSync(file)) continue;
    const prompt = readFileSync(path.join(job.dir, "prompt.md"), "utf8");
    try {
      const { result, code, stderr, wallMs } = await runClaude({
        args: argsFor(job.variant, job.taskDir),
        prompt,
        cwd: appDir(job.task.app),
        streamFile: path.join(job.dir, `r${k}.stream.jsonl`),
        outDir: OUT,
        label: `${job.task.app}/${job.task.id}/${job.variant}/r${k}`,
        env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
      });
      if (result) {
        writeFileSync(file, `${JSON.stringify({ ...result, wall_ms: wallMs }, null, 2)}\n`);
        console.log(`${job.task.app}/${job.task.id} ${job.variant} r${k}: ${result.is_error ? "ERROR" : "ok"} ${Math.round(wallMs / 1000)} s $${result.total_cost_usd?.toFixed(3)} (total ${spentUsd(OUT).toFixed(2)})`);
      } else {
        writeFileSync(path.join(job.dir, `r${k}.error.txt`), `exit ${code}\n${stderr}`);
        console.log(`${job.task.app}/${job.task.id} ${job.variant} r${k}: FAILED (exit ${code})`);
      }
    } catch (error) {
      console.log(String(error.message));
      stopped = true;
    }
  }
}));
console.log(`done; ledger total ${spentUsd(OUT).toFixed(3)} USD`);
