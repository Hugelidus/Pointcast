// Scores a run's log against the fixture's SAPI ground truth.
//   node analyze.mjs results/page-file-es-2min.json [--lag 650]
//
// Chrome's results carry no word times. A word's start is estimated from when it first appears:
// for the final text of result i, word k gets the arrival time of the first event (interim or final) of that
// result that already had more than k words ("slot" timing; it survives partial-word revisions like
// "estuvi" -> "estuviera"). Estimated start = arrival - lag, where lag is a constant: either --lag (calibrated
// on another recording) or the median lag of this run (self-calibrated, optimistic).
//
// File time: the log's `onset` event (level first above -45 dBFS in the page's audio graph) is matched with
// the same onset computed from the WAV, so every event time is converted to a time in the file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO } from "./lib.mjs";
import { scoreWords, normalize, alignWords, percentile, readWavPcm16Mono16k } from "../in-browser-whisper/score.mjs";

const args = process.argv.slice(2);
const file = args[0];
const fixedLag = args.includes("--lag") ? Number(args[args.indexOf("--lag") + 1]) : null;
const run = JSON.parse(readFileSync(file, "utf8"));
const wavName = path.basename(run.meta.wav);
const base = wavName.replace(/(-48k|-44k2)?\.wav$/, "");
const ground = JSON.parse(readFileSync(path.join(REPO, "dev", "fixtures", "audio", `${base}.words.json`), "utf8"));

// Onset of the WAV: first 512-sample (at 48 kHz, ~10.7 ms) window above -45 dBFS; at 16 kHz that is 171 samples.
const samples = readWavPcm16Mono16k(readFileSync(path.join(REPO, "dev", "fixtures", "audio", `${base}.wav`)));
let wavOnsetMs = 0;
for (let i = 0; i + 171 <= samples.length; i += 16) {
  let s = 0;
  for (let j = i; j < i + 171; j++) s += samples[j] * samples[j];
  if (20 * Math.log10(Math.sqrt(s / 171) + 1e-9) > -45) {
    wavOnsetMs = ((i + 171) / 16000) * 1000;
    break;
  }
}
const onset = run.log.find((e) => e.type === "onset");
const offset = onset ? onset.t - wavOnsetMs : 0;
const ft = (t) => t - offset; // event time -> file time

// Slot timing per (session, result index).
const firstSeen = new Map(); // key -> array of arrival times per word slot
const finalText = new Map(); // key -> {text, t}
for (const e of run.log) {
  if (e.type !== "result") continue;
  for (const r of e.results) {
    const key = `${e.session}:${r.i}`;
    const words = r.text.trim().split(/\s+/).filter(Boolean);
    const slots = firstSeen.get(key) ?? [];
    for (let k = slots.length; k < words.length; k++) slots[k] = ft(e.t);
    firstSeen.set(key, slots);
    if (r.final) finalText.set(key, { text: r.text, t: ft(e.t) });
  }
}
const hyp = [];
const sentences = [];
for (const [key, { text, t }] of finalText) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const slots = firstSeen.get(key);
  words.forEach((w, k) => hyp.push({ text: w, arrival: slots[Math.min(k, slots.length - 1)] }));
  sentences.push({ key, text, finalAt: Math.round(t) });
}
hyp.sort((a, b) => a.arrival - b.arrival);

// Lag of each matched word (arrival - true start).
const H = hyp.map((w) => ({ text: normalize(w.text), start: w.arrival })).filter((w) => w.text);
const R = ground.words.map((w) => ({ text: normalize(w.text), start: w.startMs, end: w.endMs })).filter((w) => w.text);
const { matches, pairs } = alignWords(H, R);
const lags = pairs.map(([h, r]) => H[h].start - R[r].start).sort((a, b) => a - b);
const selfLag = percentile(lags, 50);
const lag = fixedLag ?? selfLag;
const errs = pairs.map(([h, r]) => Math.abs(H[h].start - lag - R[r].start)).sort((a, b) => a - b);
const within300 = errs.filter((e) => e <= 300).length / errs.length;

// End of speech -> final result latency. Speech end after a final's last word = start of the first 250 ms
// stretch below -45 dBFS after that word's ground-truth start (the fixture has no word ends).
const loud = []; // per 10 ms frame
for (let i = 0; i + 160 <= samples.length; i += 160) {
  let s = 0;
  for (let j = i; j < i + 160; j++) s += samples[j] * samples[j];
  loud.push(20 * Math.log10(Math.sqrt(s / 160) + 1e-9) > -45);
}
const speechEndAfter = (ms) => {
  for (let f = Math.floor(ms / 10); f + 25 < loud.length; f++) if (loud.slice(f, f + 25).every((l) => !l)) return f * 10;
  return loud.length * 10;
};
const finalLatency = [];
for (const s of sentences) {
  const last = normalize(s.text.split(/\s+/).at(-1) ?? "");
  const cand = R.filter((w) => w.text === last && w.start <= s.finalAt).at(-1);
  if (cand) finalLatency.push(Math.round(s.finalAt - speechEndAfter(cand.start)));
}
finalLatency.sort((a, b) => a - b);

const score = scoreWords(hyp.map((w) => ({ text: w.text, start: w.arrival - lag })), ground);
const out = {
  file: path.basename(file),
  wav: wavName,
  sessions: run.sessions,
  errors: run.log.filter((e) => e.type === "error").map((e) => `${e.t}:${e.error}`),
  wordAccuracy: Math.round(score.wordAccuracy * 1000) / 10,
  hypWords: score.hypWords,
  refWords: score.refWords,
  onsetOffsetMs: Math.round(offset),
  lagMedianMs: Math.round(selfLag),
  lagP10P90Ms: [Math.round(percentile(lags, 10)), Math.round(percentile(lags, 90))],
  lagUsedMs: Math.round(lag),
  startErrMedianMs: Math.round(percentile(errs, 50)),
  startErrP90Ms: Math.round(percentile(errs, 90)),
  within300ms: Math.round(within300 * 1000) / 10,
  finals: sentences.length,
  endOfSpeechToFinalMs: { median: percentile(finalLatency, 50), p90: percentile(finalLatency, 90), n: finalLatency.length },
  interimEvents: run.log.filter((e) => e.type === "result" && e.results.some((r) => !r.final)).length,
  punctuation: /[.,;:¿?¡!]/.test(sentences.map((s) => s.text).join(" ")),
  capitals: /[A-ZÁÉÍÓÚÑ]/.test(sentences.map((s) => s.text).join(" ")),
  cpu: run.meta.cpu,
  wallMs: run.meta.wallMs,
  net: run.net,
};
console.log(JSON.stringify(out, null, 1));
if (args.includes("--text")) console.log(sentences.map((s) => `${s.finalAt}: ${s.text}`).join("\n"));
