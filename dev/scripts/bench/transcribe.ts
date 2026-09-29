/**
 * Benchmarks candidate Whisper models for plan step 3's local-transcription spike
 * (docs/plan-phase-1.md, done-criteria: "<60 s on a laptop CPU" for a 2-minute recording).
 *
 * Run from packages/cli (so @huggingface/transformers resolves):
 *   cd packages/cli && ./node_modules/.bin/tsx ../../dev/scripts/bench/transcribe.ts [--models tiny,base,small,large-v3-turbo]
 *     [--dtypes fp32,q8,encoder_model=fp16+decoder_model_merged=q8] [--threads 4,8] [--out results-x.json] [--extra some.wav --extra-out words.json]
 *
 * `--extra` also transcribes a WAV without ground truth (a private recording, say) and writes each
 * model's words to `--extra-out`, to compare models by hand. Neither file belongs in the repo.
 *
 * Deliberately outside `pnpm test` (conventions: "Default pnpm test must stay fast and
 * offline") — this downloads real models and burns real CPU minutes, so it lowers its own
 * priority. Results are printed per (model, audio, threads) row, and written to
 * dev/scripts/bench/results.json (or `--out`) together with the machine and the date. Every run
 * rewrites that file. results-2026-09-29.json merges one process per model and precision, so each
 * row's peakRssMB is that model's own peak.
 *
 * The plan step 3 budget is checked on es-2min (152 s of audio): under 60 s on a laptop CPU.
 * packages/cli/src/transcribe/local.slow.test.ts asserts it for the default model.
 *
 * Ground truth comes from dev/fixtures/audio/*.words.json, produced by dev/scripts/tts/generate.ps1
 * from Windows SAPI's own SpeakProgress event — see that script's header comment for why
 * that is trustworthy ground truth rather than a second guess.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { DataType } from "@huggingface/transformers";
import { LocalTranscriptionEngine } from "../../../packages/transcribe/src/index.ts";
import { readWavPcm16Mono16k } from "../../../packages/cli/src/audio/wav.ts";

// Keep the machine responsive while models run; the ONNX threads inherit this priority.
os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "dev", "fixtures", "audio");
const RESULTS_PATH = path.join(__dirname, "results.json");

interface GroundTruthWord {
  text: string;
  startMs: number;
}
interface GroundTruth {
  voice: string;
  language: string;
  text: string;
  words: GroundTruthWord[];
}

interface ModelCandidate {
  size: string;
  repo: string;
}

/**
 * Word-level timestamps need cross-attentions in the ONNX export
 * (AutomaticSpeechRecognitionPipeline._extract_token_timestamps throws
 * "Model outputs must contain cross attentions to extract timestamps" otherwise) — confirmed
 * by hand that onnx-community/whisper-tiny lacks them. The Xenova org's exports include them
 * for every size up to "small"; for large-v3-turbo, onnx-community publishes a
 * "..._timestamped" variant specifically for this (its own model card names this purpose).
 */
const ALL_CANDIDATES: ModelCandidate[] = [
  { size: "tiny", repo: "Xenova/whisper-tiny" },
  { size: "base", repo: "Xenova/whisper-base" },
  { size: "small", repo: "Xenova/whisper-small" },
  { size: "large-v3-turbo", repo: "onnx-community/whisper-large-v3-turbo_timestamped" },
];

const THREAD_COUNTS = [4, 8];
/** Plan step 3: a 2-minute Spanish recording transcribed in under 60 s. */
const ES_2MIN_BUDGET_S = 60;
const AUDIO_FILES = ["es-2min", "en-short"] as const;

/**
 * Same normalization core/src/deictics.ts's normalizeWord applies (kept byte-for-byte
 * equivalent so scoring matches what fusion will actually compare). Not imported from
 * @pointcast/core: this script lives outside every package's node_modules resolution root
 * (dev/scripts/bench is not itself a package with @pointcast/core as a declared dependency),
 * so `import "@pointcast/core"` fails to resolve at runtime here even though it type-checks
 * — confirmed by hand. Duplicating ~5 lines is simpler than adding a package.json for this
 * script (and this task's conventions rule out running pnpm install to wire one up).
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function loadGroundTruth(name: string): Promise<GroundTruth> {
  const raw = await readFile(path.join(FIXTURES_DIR, `${name}.words.json`), "utf8");
  return JSON.parse(raw) as GroundTruth;
}

async function loadSamples(name: string): Promise<Float32Array> {
  const bytes = await readFile(path.join(FIXTURES_DIR, `${name}.wav`));
  return readWavPcm16Mono16k(bytes);
}

interface TimedToken {
  text: string;
  start: number;
}

/** (matchCount, cumulativeTimeCost) — compared lexicographically so the time cost only ever
 * breaks ties between equally-good text alignments, never trades away a real text match. */
interface AlignCell {
  count: number;
  cost: number;
}

function betterOrEqual(a: AlignCell, b: AlignCell): boolean {
  if (a.count !== b.count) return a.count > b.count;
  return a.cost <= b.cost;
}

/**
 * DP alignment between two normalized-word sequences, returning the match count (for word
 * accuracy) and the index pairs (for word-start-error scoring).
 *
 * This is LCS with one change: among the many equal-length alignments that plain LCS allows
 * (natural language repeats short words constantly — "la", "el", "que", "esto" all appear
 * several times in es-2min), we additionally minimize total |hyp.start - ref.start| over the
 * matched pairs. Plain LCS backtracking picks one of those equal-length paths arbitrarily,
 * which — confirmed by hand while building this script — silently pairs e.g. the *third*
 * spoken "la" with the *first* reference "la": each individual pair still looks like "a valid
 * match" (same text) but its timestamp is meaningless, which quietly corrupts the word-start-
 * error metric (a handful of such mispairs, each off by many seconds, dominate the median/p90
 * even though the actual transcription is well-aligned word-for-word). The time-cost tie-break
 * does not change *how much* text matches (`matches`, used for accuracy) — only *which* of the
 * equally-long alignments is reported, so timing error is measured on the plausible pairing.
 */
function alignWords(hyp: TimedToken[], ref: TimedToken[]): { matches: number; pairs: [number, number][] } {
  const n = hyp.length;
  const m = ref.length;
  const dp: AlignCell[][] = Array.from({ length: n + 1 }, () => new Array<AlignCell>(m + 1));
  for (let i = 0; i <= n; i++) dp[i]![0] = { count: 0, cost: 0 };
  for (let j = 0; j <= m; j++) dp[0]![j] = { count: 0, cost: 0 };

  const matchCandidate = (i: number, j: number): AlignCell => ({
    count: dp[i - 1]![j - 1]!.count + 1,
    cost: dp[i - 1]![j - 1]!.cost + Math.abs(hyp[i - 1]!.start - ref[j - 1]!.start),
  });

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const up = dp[i - 1]![j]!;
      const left = dp[i]![j - 1]!;
      let best = betterOrEqual(up, left) ? up : left;
      if (hyp[i - 1]!.text === ref[j - 1]!.text) {
        const candidate = matchCandidate(i, j);
        if (betterOrEqual(candidate, best)) best = candidate;
      }
      dp[i]![j] = best;
    }
  }

  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cur = dp[i]![j]!;
    if (hyp[i - 1]!.text === ref[j - 1]!.text) {
      const candidate = matchCandidate(i, j);
      if (candidate.count === cur.count && candidate.cost === cur.cost) {
        pairs.push([i - 1, j - 1]);
        i--;
        j--;
        continue;
      }
    }
    const up = dp[i - 1]![j]!;
    if (up.count === cur.count && up.cost === cur.cost) {
      i--;
    } else {
      j--;
    }
  }
  pairs.reverse();
  return { matches: dp[n]![m]!.count, pairs };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

interface BenchRow {
  model: string;
  dtype?: string;
  /** Peak resident memory of this process so far, in MB (run one model per process for a clean peak). */
  peakRssMB?: number;
  audio: string;
  threads: string;
  loadSeconds: number;
  transcribeSeconds: number;
  wordAccuracy: number;
  medianStartErrorMs: number;
  p90StartErrorMs: number;
  notes?: string;
}

async function benchOneAudio(
  engine: LocalTranscriptionEngine,
  audioName: string,
  language: string,
  ground: GroundTruth,
): Promise<{ transcribeSeconds: number; wordAccuracy: number; medianStartErrorMs: number; p90StartErrorMs: number; wordsFileWords: { text: string; start: number }[] }> {
  const samples = await loadSamples(audioName);
  const t0 = performance.now();
  const wordsFile = await engine.transcribe(samples, { language });
  const transcribeSeconds = (performance.now() - t0) / 1000;

  const hypTokens: TimedToken[] = wordsFile.words
    .map((w) => ({ text: normalize(w.text), start: w.start }))
    .filter((w) => w.text !== "");
  const refTokens: TimedToken[] = ground.words
    .map((w) => ({ text: normalize(w.text), start: w.startMs }))
    .filter((w) => w.text !== "");

  const { matches, pairs } = alignWords(hypTokens, refTokens);
  const wordAccuracy = refTokens.length === 0 ? 1 : matches / refTokens.length;

  const errors = pairs
    .map(([hi, ri]) => Math.abs(hypTokens[hi]!.start - refTokens[ri]!.start))
    .sort((a, b) => a - b);

  return {
    transcribeSeconds,
    wordAccuracy,
    medianStartErrorMs: percentile(errors, 50),
    p90StartErrorMs: percentile(errors, 90),
    wordsFileWords: wordsFile.words.map((w) => ({ text: w.text, start: w.start })),
  };
}

/** Plan step 3 / es-short fixture-specific check: every ground-truth "esto" must be found by
 * the engine at a plausible time (within 1200 ms of the ground-truth SpeakProgress time —
 * generous, since this checks "found it at roughly the right place", not timing precision). */
async function checkEstoDeictics(engine: LocalTranscriptionEngine, language: string): Promise<string> {
  const ground = await loadGroundTruth("es-short");
  const samples = await loadSamples("es-short");
  const wordsFile = await engine.transcribe(samples, { language });

  const refEstos = ground.words.filter((w: GroundTruthWord) => normalize(w.text) === "esto");
  const hypEstos = wordsFile.words.filter((w) => normalize(w.text) === "esto");

  const findings: string[] = [];
  for (const ref of refEstos) {
    const nearest = hypEstos
      .map((h) => ({ h, err: Math.abs(h.start - ref.startMs) }))
      .sort((a, b) => a.err - b.err)[0];
    if (!nearest) {
      findings.push(`MISSING esto@${ref.startMs}ms`);
    } else {
      const ok = nearest.err <= 1200;
      findings.push(`esto@${ref.startMs}ms -> ${nearest.h.start}ms (err ${nearest.err}ms) ${ok ? "OK" : "IMPLAUSIBLE"}`);
    }
  }
  return findings.join("; ");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2),
    options: {
      models: { type: "string" }, // comma-separated sizes, e.g. "tiny,base"
      dtypes: { type: "string", default: "fp32" }, // comma-separated, e.g. "fp32,q8"
      threads: { type: "string" }, // comma-separated, default 4,8
      out: { type: "string" }, // results file name next to this script, default results.json
      extra: { type: "string" },
      "extra-out": { type: "string" },
      "load-timeout-min": { type: "string", default: "8" },
    },
  });

  const requestedSizes = values.models ? new Set(values.models.split(",")) : null;
  const candidates = requestedSizes ? ALL_CANDIDATES.filter((c) => requestedSizes.has(c.size)) : ALL_CANDIDATES;
  const loadTimeoutMs = Number.parseFloat(values["load-timeout-min"]!) * 60 * 1000;

  const groundEs2min = await loadGroundTruth("es-2min");
  const groundEnShort = await loadGroundTruth("en-short");
  const groundByAudio: Record<string, GroundTruth> = { "es-2min": groundEs2min, "en-short": groundEnShort };
  const languageByAudio: Record<string, string> = { "es-2min": "es", "en-short": "en" };

  const rows: BenchRow[] = [];
  // "fp32", or per ONNX file: "encoder_model=fp16+decoder_model_merged=q8".
  const dtypes = values.dtypes!.split(",").map((d) =>
    d.includes("=") ? (Object.fromEntries(d.split("+").map((part) => part.split("="))) as Record<string, DataType>) : (d as DataType),
  );
  const threadCounts = values.threads ? values.threads.split(",").map(Number) : THREAD_COUNTS;
  const extraWords: Record<string, { text: string; start: number }[]> = {};
  const peakRssMB = () => Math.round(process.resourceUsage().maxRSS / 1024);

  for (const candidate of candidates) for (const dtypeOption of dtypes) {
    const dtype = typeof dtypeOption === "string" ? dtypeOption : JSON.stringify(dtypeOption);
    console.log(`\n=== ${candidate.size} (${candidate.repo}) ${dtype} ===`);

    for (const threads of threadCounts) {
      const engine = new LocalTranscriptionEngine({ model: candidate.repo, dtype: dtypeOption, threads });

      const loadStart = performance.now();
      try {
        await withTimeout(engine.preload(), loadTimeoutMs, `loading ${candidate.repo}`);
      } catch (err) {
        console.error(`[skip] ${candidate.size}: ${(err as Error).message}`);
        rows.push({
          model: candidate.repo,
          audio: "(all)",
          threads: String(threads),
          loadSeconds: NaN,
          transcribeSeconds: NaN,
          wordAccuracy: NaN,
          medianStartErrorMs: NaN,
          p90StartErrorMs: NaN,
          notes: `load failed/timed out: ${(err as Error).message}`,
        });
        continue;
      }
      const loadSeconds = (performance.now() - loadStart) / 1000;
      console.log(`  loaded in ${loadSeconds.toFixed(1)}s (threads=${threads})`);

      for (const audioName of AUDIO_FILES) {
        const language = languageByAudio[audioName]!;
        const ground = groundByAudio[audioName]!;
        const result = await benchOneAudio(engine, audioName, language, ground);
        const row: BenchRow = {
          model: candidate.repo,
          dtype,
          peakRssMB: peakRssMB(),
          audio: audioName,
          threads: String(threads),
          loadSeconds,
          transcribeSeconds: result.transcribeSeconds,
          wordAccuracy: result.wordAccuracy,
          medianStartErrorMs: result.medianStartErrorMs,
          p90StartErrorMs: result.p90StartErrorMs,
          ...(audioName === "es-2min"
            ? { notes: result.transcribeSeconds < ES_2MIN_BUDGET_S ? "within the 60 s budget" : "OVER the 60 s budget" }
            : {}),
        };
        rows.push(row);
        console.log(
          `  [${audioName}] ${result.transcribeSeconds.toFixed(1)}s  acc=${(result.wordAccuracy * 100).toFixed(1)}%  ` +
            `median=${result.medianStartErrorMs.toFixed(0)}ms  p90=${result.p90StartErrorMs.toFixed(0)}ms`,
        );
      }

      // es-short "esto" deictic check runs once per model (threads do not affect correctness,
      // only speed), so only do it for the first thread count to avoid a redundant pass.
      if (values.extra && threads === threadCounts[0]) {
        const samples = readWavPcm16Mono16k(await readFile(values.extra));
        const t0 = performance.now();
        const words = await engine.transcribe(samples, { language: "es" });
        const seconds = (performance.now() - t0) / 1000;
        extraWords[`${candidate.repo} ${dtype}`] = words.words.map((w) => ({ text: w.text, start: w.start }));
        console.log(`  [extra] ${(samples.length / 16000).toFixed(1)}s of audio in ${seconds.toFixed(1)}s, ${words.words.length} words`);
      }

      if (threads === threadCounts[0]) {
        const estoReport = await checkEstoDeictics(engine, "es");
        console.log(`  [es-short esto check] ${estoReport}`);
        rows.push({
          model: candidate.repo,
          dtype,
          audio: "es-short(esto-check)",
          threads: String(threads),
          loadSeconds,
          transcribeSeconds: NaN,
          wordAccuracy: NaN,
          medianStartErrorMs: NaN,
          p90StartErrorMs: NaN,
          notes: estoReport,
        });
      }
    }
  }

  const machine = `${os.cpus()[0]?.model.trim() ?? "unknown CPU"}, ${os.cpus().length} logical cores`;
  const report = { date: new Date().toISOString().slice(0, 10), machine, rows };
  const resultsPath = values.out ? path.join(__dirname, path.basename(values.out)) : RESULTS_PATH;
  await writeFile(resultsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${resultsPath}`);
  if (values["extra-out"]) await writeFile(values["extra-out"], `${JSON.stringify(extraWords, null, 2)}\n`, "utf8");
  console.log(`CPU: ${machine}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${(ms / 1000).toFixed(0)}s: ${label}`)), ms)),
  ]);
}

main()
  // ONNX Runtime's thread pool can keep the process alive after the last model ran.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
