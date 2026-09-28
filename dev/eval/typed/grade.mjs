// Grades the typed evaluation and summarizes it per variant, app and task.
//
//   node dev/eval/typed/grade.mjs <out-dir>
//
// Correctness uses dev/eval/grade.mjs's rules unchanged (gradeAnswer), with one change per task
// (tasks.json `truth`, topic "."): correct when the answer has at least one item and EVERY item is
// the right element in an accepted file; hedging or a shared construct is wrong. Tool calls come
// from each run's stream (every tool_use event): Grep+Glob, Read, MCP calls, and the Grep/Glob
// calls made before the first Read of a ground-truth file. Writes grades.json and summary.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAnswer, gradeAnswer } from "../grade.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? "");
if (!existsSync(OUT)) throw new Error("usage: node dev/eval/typed/grade.mjs <out-dir>");
const config = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const VARIANTS = ["A", "B", "C"];
const slash = (p) => String(p ?? "").replace(/\\/g, "/");

function toolCalls(streamFile) {
  const calls = [];
  for (const line of readFileSync(streamFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "assistant") continue;
    for (const c of e.message?.content ?? []) if (c.type === "tool_use") calls.push({ name: c.name, input: c.input });
  }
  return calls;
}

const runs = [];
for (const task of config.tasks) {
  const change = { id: task.id, topic: ".", ...task.truth };
  for (const variant of VARIANTS) {
    const dir = path.join(OUT, task.app, task.id, variant);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => /^r\d+\.json$/.test(n)).sort()) {
      const result = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      const items = result.is_error ? undefined : extractAnswer(result);
      const grade = items ? gradeAnswer(items, [change])[0] : { status: "no answer", why: result.subtype ?? "error" };
      const calls = toolCalls(path.join(dir, f.replace(".json", ".stream.jsonl")));
      const isTruth = (p) => task.truth.files.some((t) => slash(p).endsWith(`/${t}`) || slash(p) === t);
      const firstTruthRead = calls.findIndex((c) => c.name === "Read" && isTruth(c.input?.file_path));
      const searches = (list) => list.filter((c) => c.name === "Grep" || c.name === "Glob").length;
      const u = result.usage ?? {};
      runs.push({
        app: task.app,
        task: task.id,
        kind: task.kind,
        variant,
        run: f.replace(".json", ""),
        status: grade.status,
        why: grade.why,
        answer: items,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        costUsd: result.total_cost_usd ?? 0,
        turns: result.num_turns ?? 0,
        durationS: (result.duration_ms ?? 0) / 1000,
        toolCalls: calls.length,
        searches: searches(calls),
        reads: calls.filter((c) => c.name === "Read").length,
        mcpCalls: calls.filter((c) => c.name.startsWith("mcp__")).length,
        searchesBeforeTruth: firstTruthRead >= 0 ? searches(calls.slice(0, firstTruthRead)) : null,
        readTruth: firstTruthRead >= 0,
        sequence: calls.map((c) => `${c.name.replace("mcp__pointcast__", "mcp:")}(${slash(c.input?.pattern ?? c.input?.file_path ?? c.input?.id ?? "").split("/").slice(-2).join("/")})`),
      });
    }
  }
}

const median = (xs) => {
  const s = xs.filter((x) => x !== null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const k = (n) => (Number.isNaN(n) ? "–" : `${(n / 1000).toFixed(1)} k`);
const f1 = (n, d = 1) => (Number.isNaN(n) ? "–" : n.toFixed(d));

function row(rs) {
  const correct = rs.filter((r) => r.status === "correct").length;
  return {
    n: rs.length,
    correct,
    acc: rs.length ? `${correct}/${rs.length} (${Math.round((100 * correct) / rs.length)} %)` : "–",
    medIn: median(rs.map((r) => r.inputTokens)),
    meanIn: mean(rs.map((r) => r.inputTokens)),
    medOut: median(rs.map((r) => r.outputTokens)),
    medCalls: median(rs.map((r) => r.toolCalls)),
    medSearch: median(rs.map((r) => r.searches)),
    meanSearch: mean(rs.map((r) => r.searches)),
    medBefore: median(rs.map((r) => r.searchesBeforeTruth)),
    medTurns: median(rs.map((r) => r.turns)),
    medTime: median(rs.map((r) => r.durationS)),
    meanCost: mean(rs.map((r) => r.costUsd)),
    sumCost: rs.reduce((a, r) => a + r.costUsd, 0),
  };
}

const lines = [];
const table = (title, groups) => {
  lines.push(`### ${title}`, "", "| Group | Correct | Median input | Mean input | Median output | Median tool calls | Median Grep+Glob | Mean Grep+Glob | Median searches before 1st truth read | Median turns | Median time (s) | Mean cost (USD) | Total cost (USD) |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [name, rs] of groups) {
    const r = row(rs);
    lines.push(`| ${name} | ${r.acc} | ${k(r.medIn)} | ${k(r.meanIn)} | ${k(r.medOut)} | ${f1(r.medCalls)} | ${f1(r.medSearch)} | ${f1(r.meanSearch)} | ${f1(r.medBefore)} | ${f1(r.medTurns)} | ${f1(r.medTime, 0)} | ${f1(r.meanCost, 3)} | ${f1(r.sumCost, 2)} |`);
  }
  lines.push("");
};
table("Per variant", VARIANTS.map((v) => [v, runs.filter((r) => r.variant === v)]));
for (const app of Object.keys(config.apps)) table(`${app}`, VARIANTS.map((v) => [v, runs.filter((r) => r.variant === v && r.app === app)]));

lines.push("### Per task (status per run; input tokens; Grep+Glob)", "", "| App | Task | Kind | A | B | C |", "|---|---|---|---|---|---|");
for (const task of config.tasks) {
  const cell = (v) =>
    runs
      .filter((r) => r.task === task.id && r.variant === v)
      .map((r) => `${r.status === "correct" ? "✓" : r.status === "wrong" ? "✗" : r.status} ${k(r.inputTokens)} · ${r.searches}`)
      .join("<br>") || "–";
  lines.push(`| ${task.app} | ${task.id} | ${task.kind.join(", ")} | ${cell("A")} | ${cell("B")} | ${cell("C")} |`);
}
lines.push("", "### Failures", "");
for (const r of runs.filter((x) => x.status !== "correct")) lines.push(`- ${r.app}/${r.task} ${r.variant} ${r.run}: ${r.status}: ${r.why}`);

writeFileSync(path.join(OUT, "grades.json"), `${JSON.stringify(runs, null, 2)}\n`);
writeFileSync(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
