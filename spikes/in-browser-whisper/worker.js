/**
 * Module worker that runs Whisper with the transformers.js BROWSER bundle.
 *
 * Runs in a worker, not the page, because that is how the extension would do it: the offscreen
 * document stays responsive (recorder, messages) while the model runs in a worker it owns.
 *
 * Code comes only from local files: dist/transformers.js is the self-contained browser build
 * (it bundles onnxruntime-web's ort.webgpu.bundle.min.mjs), and the ONNX Runtime wasm files are
 * pointed at /vendor/ort/ instead of transformers.js' default jsDelivr CDN. `vendorBase` lets the
 * MV3 probe reuse this file from chrome-extension:// URLs.
 *
 * Messages in:  {type:"load", config} → {type:"loaded", ...timings}
 *               {type:"transcribe", samples, language} → {type:"transcribed", chunks, seconds}
 */
const params = new URL(self.location.href).searchParams;
const vendorBase = params.get("vendor") ?? "/vendor/";
/** ?nocache=1 keeps weights in memory only (used by the MV3 probe on a nearly full disk). */
const useCache = params.get("nocache") !== "1";
const { pipeline, env } = await import(`${vendorBase}transformers/transformers.js`);

let asr = null;

function post(message) {
  self.postMessage(message);
}

async function load(config) {
  const { model, device, dtype, threads } = config;
  env.allowLocalModels = false; // never probe our own server for /models/...
  env.useBrowserCache = useCache; // Cache API "transformers-cache": weights survive reloads
  // A string prefix (not {mjs, wasm}) also turns off transformers.js' blob: URL import of the
  // wasm factory, which an extension page's CSP would not allow.
  env.backends.onnx.wasm.wasmPaths = `${vendorBase}ort/`;
  if (threads) env.backends.onnx.wasm.numThreads = threads;

  const files = new Map();
  let firstByteAt = null;
  let downloadedAt = null;
  let retries = 0;
  const t0 = performance.now();
  const create = () => pipeline("automatic-speech-recognition", model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && p.file) {
        firstByteAt ??= performance.now();
        files.set(p.file, { loaded: p.loaded, total: p.total });
      } else if (p.status === "done" && p.file) {
        downloadedAt = performance.now();
        const f = files.get(p.file);
        if (f) f.done = true;
        post({ type: "progress", file: p.file, done: true });
      }
    },
  });
  // Hugging Face sometimes answers 429 (rate limit) for a single file; an extension would retry too.
  for (;;) {
    try {
      asr = await create();
      break;
    } catch (err) {
      if (!String(err).includes("(429)") || retries >= 3) throw err;
      retries++;
      post({ type: "progress", file: `HF 429, retry ${retries} in 30 s` });
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  // Includes any 429 back-off; `retries` says when that happened.
  const loadSeconds = (performance.now() - t0) / 1000;
  const onnxFiles = [...files].filter(([name]) => name.endsWith(".onnx"));
  post({
    type: "loaded",
    loadSeconds,
    // Time until the last file finished arriving (network or Cache API), then session creation.
    filesSeconds: downloadedAt === null ? null : (downloadedAt - t0) / 1000,
    sessionSeconds: downloadedAt === null ? null : (performance.now() - downloadedAt) / 1000,
    bytes: onnxFiles.reduce((sum, [, f]) => sum + (f.total ?? 0), 0),
    files: onnxFiles.map(([name, f]) => `${name} ${(f.total / 1e6).toFixed(1)} MB`),
    retries429: retries,
    effectiveThreads: env.backends.onnx.wasm.numThreads,
    crossOriginIsolated: self.crossOriginIsolated,
  });
}

/** Chunks the pipeline will generate for this many samples (30 s windows, 5 s stride, 20 s jump). */
function chunkCount(length) {
  const window = 30 * 16000;
  const jump = window - 2 * (window / 6);
  let count = 1;
  for (let offset = 0; offset + window < length; offset += jump) count++;
  return count;
}

/**
 * options.timestamps: "word" (default, what pointcast needs) or "segment" (to measure the cost of
 * word timestamps). options.progress: report each finished 30 s chunk. The 4.3 pipeline has no
 * chunk callback, but it passes unknown options on to generate(), which calls streamer.end()
 * once per chunk: the smallest streamer is enough for a real progress bar.
 */
async function transcribe(samples, language, options = {}) {
  const t0 = performance.now();
  const total = chunkCount(samples.length);
  let done = 0;
  const streamer = options.progress
    ? { put() {}, end: () => post({ type: "chunk", done: ++done, total, atSeconds: (performance.now() - t0) / 1000 }) }
    : undefined;
  // Same options as packages/cli/src/transcribe/local.ts (chunk 30 s, library default stride).
  const out = await asr(samples, {
    return_timestamps: options.timestamps === "segment" ? true : "word",
    chunk_length_s: 30,
    language,
    task: "transcribe",
    ...(streamer ? { streamer } : {}),
  });
  const seconds = (performance.now() - t0) / 1000;
  post({ type: "transcribed", seconds, text: out.text, chunks: out.chunks ?? [], chunkCount: total, chunksReported: done });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load(data.config);
    else if (data.type === "transcribe") await transcribe(data.samples, data.language, data.options);
  } catch (err) {
    post({ type: "error", message: String(err?.stack ?? err) });
  }
};
post({ type: "ready" });
