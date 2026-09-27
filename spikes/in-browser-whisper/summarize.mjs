/**
 * Prints the spike's results as a Markdown table: one line per (runtime, config, audio), with the
 * runs listed (not only averaged) so run-to-run spread is visible.
 *
 *   node spikes/in-browser-whisper/summarize.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => (existsSync(path.join(HERE, "results", f)) ? JSON.parse(readFileSync(path.join(HERE, "results", f), "utf8")) : null);
const fmt = (n, d = 1) => (n === undefined || n === null || Number.isNaN(n) ? "" : n.toFixed(d));

const lines = [];
const groups = new Map();
function add(key, row) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

for (const r of read("node-baseline.json")?.rows ?? []) {
  add(`node|${r.model}|cpu|${r.dtype}|${r.threads}|${r.audio}`, { ...r, runtime: "Node", device: "cpu" });
}
const browser = read("browser-runs.json");
for (const run of browser?.runs ?? []) {
  if (run.error) {
    lines.push(`- ${run.case}: FAILED (${run.error.split("\n")[0].slice(0, 140)})`);
    continue;
  }
  for (const r of run.rows) {
    const coi = run.isolatedServer ? "" : " not-isolated";
    // Segment-only timestamps and single-load (memory) runs are separate experiments: own lines.
    const variant = [r.timestamps === "segment" ? "segment ts" : "", r.progressEvents ? "single load+progress" : ""].filter(Boolean).join(", ");
    add(`browser|${r.model}|${r.device}|${r.dtype}|${r.threads}${coi}|${r.audio}|${variant}`, {
      ...r,
      runtime: `Browser${coi}${variant ? ` (${variant})` : ""}`,
      memory: run.memory,
    });
  }
}

console.log("| runtime | model | device | dtype | threads | audio | load cold s | load cached s | transcribe s (runs) | s per audio min | word acc | start err med/p90 ms | renderer peak MB |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [, rows] of groups) {
  const r = rows[0];
  const times = rows.map((x) => x.transcribeSeconds);
  const perMin = rows.map((x) => x.secondsPerAudioMinute).reduce((a, b) => a + b, 0) / rows.length;
  const accs = rows[0].wordAccuracy === undefined ? "n/a" : [...new Set(rows.map((x) => fmt(x.wordAccuracy * 100)))].join("/");
  const errs = rows[0].medianStartErrorMs === undefined ? "n/a" : [...new Set(rows.map((x) => `${x.medianStartErrorMs}/${x.p90StartErrorMs}`))].join(", ");
  const peaks = [...new Set(rows.map((x) => x.memory?.rendererPeakWorkingSetMB).filter(Boolean))].join("/");
  const loads = [...new Set(rows.map((x) => fmt(x.loadSeconds)))].join("/");
  console.log(
    `| ${r.runtime} | ${r.model.replace("Xenova/", "")} | ${r.device} | ${r.dtype} | ${r.threads} | ${r.audio} | ${loads}${r.cache === "cached" ? " (cached)" : ""} | ${fmt(r.cachedLoadSeconds)} | ` +
      `${times.map((t) => fmt(t)).join(", ")} | ${fmt(perMin)} | ${accs}${accs === "n/a" ? "" : " %"} | ${errs} | ${peaks} |`,
  );
}
if (lines.length) console.log(`\n${lines.join("\n")}`);
