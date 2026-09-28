// Grades every answer of a run against the scenarios' ground truth and writes a summary table.
//
//   node dev/eval/grade.mjs <run-dir>        (e.g. dev/eval/.runs/2026-09-28_10-00-00)
//
// Writes <run-dir>/grades.json (every decision, for a human to audit) and <run-dir>/summary.md.
//
// Grading is deterministic, from regular expressions in each scenario's "changes":
//   topic  — which answer items talk about this change (matched on the item's "request");
//   files  — files where the edit may go (suffix match on the item's "file");
//   target — what the item's "target" must mention to be the right element (or, with "lines",
//            an item whose "line" falls in that range of the file);
//   wrong  — optional: a file or construct that means a wrong or shared-style edit
//            (e.g. the shared .primary class, or the other "Export" button).
// A change is correct when at least one item addresses it and EVERY item that addresses it is
// right: hedging between the right element and a wrong one counts as wrong, like editing a
// shared style that also changes elements the user did not point at.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readScenario } from "./lib/apps.mjs";

/** Lowercase without accents, so "Violeta"/"violeta" and "botón"/"boton" compare equal. */
export function fold(/** @type {string} */ text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const re = (/** @type {string} */ source) => new RegExp(source, "i");
const slash = (/** @type {string} */ p) => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * @typedef {{ request: string, file: string, line?: number, target: string, confidence?: number }} AnswerItem
 * @typedef {{ id: string, summary: string, topic: string, files: string[], target: string, wrong?: string, lines?: [number, number] }} Change
 * @typedef {{ id: string, status: "correct" | "wrong" | "missed", items: number[], why: string }} ChangeGrade
 */

/** Is this item the right element in an accepted file, with no wrong construct? */
export function isRight(/** @type {AnswerItem} */ item, /** @type {Change} */ change) {
  const file = slash(item.file);
  const fileOk = change.files.some((f) => file === f || file.endsWith(`/${f}`));
  // `wrong` looks at the construct itself, not at the agent's comments after it: "#export-btn
  // (now styled by button.primary)" edits the right element; "button.primary (shared…)" does not.
  const construct = fold(item.target).replace(/\s*[(—–].*$/s, "");
  const where = `${file} ${construct}`;
  if (change.wrong && re(change.wrong).test(where)) return { ok: false, why: `wrong construct: ${file} · ${item.target}` };
  if (!fileOk) return { ok: false, why: `file not accepted: ${file}` };
  // `lines` is for elements that only their position tells apart (two identical cards).
  const lineOk = change.lines !== undefined && Number(item.line) >= change.lines[0] && Number(item.line) <= change.lines[1];
  if (!lineOk && !re(change.target).test(fold(item.target))) return { ok: false, why: `other element: ${item.target}` };
  return { ok: true, why: "" };
}

/** @returns {ChangeGrade[]} */
export function gradeAnswer(/** @type {AnswerItem[]} */ items, /** @type {Change[]} */ changes) {
  const about = (/** @type {AnswerItem} */ item, /** @type {Change} */ change) => re(change.topic).test(fold(item.request));
  return changes.map((change) => {
    // Topics are loose ("remove" fits two requests), so an item that is exactly right for
    // another change it also talks about belongs to that change, not to this one.
    const idx = items.flatMap((item, i) => {
      if (!about(item, change)) return [];
      const elsewhere = changes.some((other) => other !== change && about(item, other) && isRight(item, other).ok);
      return elsewhere ? [] : [i];
    });
    if (idx.length === 0) return { id: change.id, status: "missed", items: [], why: "no item addresses it" };
    const bad = idx.map((i) => isRight(/** @type {AnswerItem} */ (items[i]), change)).filter((r) => !r.ok);
    return bad.length === 0
      ? { id: change.id, status: "correct", items: idx, why: "" }
      : { id: change.id, status: "wrong", items: idx, why: bad.map((b) => b.why).join("; ") };
  });
}

/**
 * The agent's JSON answer from a `claude -p --output-format json` result: structured_output when
 * --json-schema was honored, else the first JSON object in the final text.
 * @returns {AnswerItem[] | undefined}
 */
export function extractAnswer(/** @type {any} */ result) {
  let answer = result?.structured_output;
  if (!answer && typeof result?.result === "string") {
    const text = result.result;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        answer = JSON.parse(text.slice(start, end + 1));
      } catch {
        answer = undefined;
      }
    }
  }
  return Array.isArray(answer?.changes) ? answer.changes : undefined;
}

/** Tokens, cost, turns and time of one run, straight from the CLI's JSON result. */
export function usageOf(/** @type {any} */ result) {
  const u = result?.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    costUsd: result?.total_cost_usd ?? 0,
    turns: result?.num_turns ?? 0,
    durationMs: result?.duration_ms ?? 0,
  };
}

const mean = (/** @type {number[]} */ xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * One row per app × condition: mean accuracy and usage over its runs.
 * @param {{ app: string, condition: string, ok: boolean, correct: number, total: number, usage: ReturnType<typeof usageOf> }[]} runs
 */
export function summarize(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.app}\u0000${r.condition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((rs) => {
    const ok = rs.filter((r) => r.ok);
    const m = (/** @type {(r: any) => number} */ f) => mean(ok.map(f));
    return {
      app: rs[0].app,
      condition: rs[0].condition,
      runs: rs.length,
      failed: rs.length - ok.length,
      correct: ok.map((r) => `${r.correct}/${r.total}`).join(", "),
      accuracy: m((r) => r.correct / r.total),
      inputTokens: m((r) => r.usage.inputTokens),
      cacheCreationTokens: m((r) => r.usage.cacheCreationTokens),
      cacheReadTokens: m((r) => r.usage.cacheReadTokens),
      outputTokens: m((r) => r.usage.outputTokens),
      costUsd: m((r) => r.usage.costUsd),
      turns: m((r) => r.usage.turns),
      durationS: m((r) => r.usage.durationMs / 1000),
    };
  });
}

export function toMarkdown(/** @type {ReturnType<typeof summarize>} */ rows) {
  const k = (/** @type {number} */ n) => (Number.isNaN(n) ? "–" : `${(n / 1000).toFixed(1)} k`);
  const f = (/** @type {number} */ n, d = 1) => (Number.isNaN(n) ? "–" : n.toFixed(d));
  const lines = [
    "| App | Condition | Runs | Correct per run | Accuracy | Input total | Uncached | Cache write | Cache read | Output | Cost (USD) | Turns | Time (s) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const runs = r.failed ? `${r.runs} (${r.failed} failed)` : String(r.runs);
    const acc = Number.isNaN(r.accuracy) ? "–" : `${Math.round(r.accuracy * 100)} %`;
    lines.push(
      `| ${r.app} | ${r.condition} | ${runs} | ${r.correct || "–"} | ${acc} | ${k(r.inputTokens + r.cacheCreationTokens + r.cacheReadTokens)} | ${k(r.inputTokens)} | ${k(r.cacheCreationTokens)} | ${k(r.cacheReadTokens)} | ${k(r.outputTokens)} | ${f(r.costUsd, 3)} | ${f(r.turns)} | ${f(r.durationS, 0)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Reads <run-dir>/<app>/<condition>/r<k>.json, grades each and writes grades.json + summary.md. */
export function gradeRunDir(/** @type {string} */ runDir) {
  const runs = [];
  for (const app of readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const changes = readScenario(app.name).changes;
    for (const cond of readdirSync(path.join(runDir, app.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = path.join(runDir, app.name, cond.name);
      for (const file of readdirSync(dir).filter((f) => /^r\d+\.json$/.test(f)).sort()) {
        const result = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
        const items = result.is_error ? undefined : extractAnswer(result);
        const grades = items ? gradeAnswer(items, changes) : [];
        runs.push({
          app: app.name,
          condition: cond.name,
          run: file.replace(".json", ""),
          ok: items !== undefined,
          correct: grades.filter((g) => g.status === "correct").length,
          total: changes.length,
          grades,
          answer: items,
          usage: usageOf(result),
        });
      }
    }
  }
  const rows = summarize(runs);
  writeFileSync(path.join(runDir, "grades.json"), `${JSON.stringify(runs, null, 2)}\n`);
  writeFileSync(path.join(runDir, "summary.md"), toMarkdown(rows));
  return { runs, rows };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runDir = process.argv[2];
  if (!runDir || !existsSync(runDir)) {
    console.error("usage: node dev/eval/grade.mjs <run-dir>");
    process.exit(1);
  }
  const { runs, rows } = gradeRunDir(path.resolve(runDir));
  for (const r of runs) {
    const detail = r.grades.map((g) => `${g.id}:${g.status}${g.why ? ` (${g.why})` : ""}`).join(" | ");
    console.log(`${r.app} ${r.condition} ${r.run}: ${r.ok ? `${r.correct}/${r.total}` : "NO ANSWER"}  ${detail}`);
  }
  console.log(`\n${toMarkdown(rows)}`);
}
