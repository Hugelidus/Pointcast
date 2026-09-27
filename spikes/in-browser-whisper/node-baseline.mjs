/**
 * Node baseline for the in-browser spike: the same pipeline options as
 * packages/cli/src/transcribe/local.ts (onnxruntime-node, CPU, 4 intra/inter-op threads, 30 s
 * chunks, forced language), scored with the same score.mjs as the page. Re-measured here so the
 * browser/Node comparison uses today's fixtures and one scoring implementation, and so the
 * dtype effect (fp32, what the CLI uses, vs q8, the browser's WASM default) can be told apart
 * from the runtime effect (onnxruntime-node vs onnxruntime-web).
 *
 *   node spikes/in-browser-whisper/node-baseline.mjs [--model Xenova/whisper-base] [--dtypes fp32,q8]
 *
 * Does not import packages/cli (TypeScript, and the spike must not touch product code); the
 * options below mirror LocalTranscriptionEngine line by line.
 */
import { readFileSync, realpathSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chunksToWords, estoCheck, readWavPcm16Mono16k, scoreWords } from "./score.mjs";

os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const pkg = realpathSync(path.join(REPO, "packages", "cli", "node_modules", "@huggingface", "transformers"));
const { pipeline, env } = await import(pathToFileURL(path.join(pkg, "dist", "transformers.node.mjs")).href);

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const model = opt("--model", "Xenova/whisper-base");
const dtypes = opt("--dtypes", "fp32,q8").split(",");
const threads = Number(opt("--threads", "4"));
const repeats = Number(opt("--repeats", "2"));

const audios = ["es-short", "es-2min"].map((name) => ({
  name,
  samples: readWavPcm16Mono16k(readFileSync(path.join(REPO, "fixtures", "audio", `${name}.wav`))),
  ground: JSON.parse(readFileSync(path.join(REPO, "fixtures", "audio", `${name}.words.json`), "utf8")),
}));

const rows = [];
for (const dtype of dtypes) {
  // fp32 files are already in the library's cache (the CLI downloaded them). Other dtypes are kept
  // in an in-memory cache: nothing is added under node_modules, and nothing is written to the disk
  // (C: was full during the spike). Node cannot run without some cache: transformers.js hands
  // onnxruntime-node a file path from the FS cache, or a buffer from a custom cache.
  env.useFSCache = dtype === "fp32";
  env.useCustomCache = dtype !== "fp32";
  env.customCache = env.useCustomCache ? memoryCache() : null;
  const t0 = performance.now();
  const load = () =>
    pipeline("automatic-speech-recognition", model, {
      dtype,
      session_options: { executionProviders: ["cpu"], intraOpNumThreads: threads, interOpNumThreads: threads },
    });
  // Hugging Face answered 429 once during the spike; one retry after its rate-limit window helps.
  const asr = await load().catch(async (err) => {
    if (!String(err).includes("(429)")) throw err;
    console.log("  HF 429, retrying in 60 s");
    await new Promise((r) => setTimeout(r, 60_000));
    return load();
  });
  const loadSeconds = (performance.now() - t0) / 1000;
  console.log(`${model} ${dtype} loaded in ${loadSeconds.toFixed(1)} s`);
  for (const audio of audios) {
    for (let run = 1; run <= repeats; run++) {
      const t1 = performance.now();
      const out = await asr(audio.samples, { return_timestamps: "word", chunk_length_s: 30, language: "es", task: "transcribe" });
      const transcribeSeconds = (performance.now() - t1) / 1000;
      const words = chunksToWords(out.chunks);
      const score = scoreWords(words, audio.ground);
      const row = {
        runtime: "node (onnxruntime-node)", model, dtype, threads, audio: audio.name, run, loadSeconds, transcribeSeconds,
        secondsPerAudioMinute: (transcribeSeconds / (audio.samples.length / 16000)) * 60, ...score,
        esto: audio.name === "es-short" ? estoCheck(words, audio.ground) : undefined,
        // Peak resident set of this Node process so far (whole run), for comparison with Chromium.
        maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      };
      rows.push(row);
      console.log(
        `  ${audio.name} #${run}: ${transcribeSeconds.toFixed(1)} s, acc ${(score.wordAccuracy * 100).toFixed(1)} %, ` +
          `err ${score.medianStartErrorMs}/${score.p90StartErrorMs} ms${row.esto ? ` | ${row.esto}` : ""}`,
      );
    }
  }
  await asr.dispose?.();
  save(rows.splice(0));
}

/** The two methods of the Web Cache API that transformers.js' customCache needs, backed by a Map. */
function memoryCache() {
  const store = new Map();
  return {
    async match(key) {
      const entry = store.get(String(key));
      return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
    },
    async put(key, response) {
      store.set(String(key), { body: new Uint8Array(await response.arrayBuffer()), headers: [...response.headers] });
    },
  };
}

/** Appends rows to results/node-baseline.json after each dtype, so a later failure keeps them. */
function save(newRows) {
  mkdirSync(path.join(HERE, "results"), { recursive: true });
  const file = path.join(HERE, "results", "node-baseline.json");
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).rows : [];
  const machine = `${os.cpus()[0]?.model.trim()}, ${os.cpus().length} logical cores`;
  writeFileSync(file, `${JSON.stringify({ machine, at: new Date().toISOString(), rows: [...previous, ...newRows] }, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
