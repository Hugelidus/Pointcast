/**
 * Page logic: environment report, fixture loading, one worker per configuration, scoring.
 * The runner (runner.mjs) drives the same code through `window.spike`; a person drives it with
 * the form. Base URLs are relative to this page so the MV3 probe can reuse the file.
 */
import { chunksToWords, estoCheck, readWavPcm16Mono16k, scoreWords } from "./score.mjs";

const $ = (id) => document.getElementById(id);
const pageParams = new URLSearchParams(location.search);
/** Where /vendor/ and /fixtures/ live; the MV3 probe overrides it. */
const VENDOR = pageParams.get("vendor") ?? "/vendor/";
const FIXTURES = pageParams.get("fixtures") ?? "/fixtures/audio/";
const results = [];

function log(line) {
  const el = $("log");
  if (el) {
    el.textContent += `${new Date().toISOString().slice(11, 19)} ${line}\n`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(`[spike] ${line}`);
}

async function getEnv() {
  const env = {
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    webgpu: null,
  };
  if ("gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        const info = adapter.info ?? {};
        env.webgpu = {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
          shaderF16: adapter.features.has("shader-f16"),
          maxBufferSizeMB: Math.round(adapter.limits.maxBufferSize / 2 ** 20),
        };
      } else env.webgpu = "navigator.gpu exists but requestAdapter() returned null";
    } catch (err) {
      env.webgpu = `requestAdapter failed: ${err}`;
    }
  } else env.webgpu = "navigator.gpu missing";
  return env;
}

/** Heuristic, reported next to every WebGPU number: software adapters are not representative. */
function isSoftwareAdapter(gpu) {
  if (!gpu || typeof gpu !== "object") return null;
  const text = `${gpu.vendor} ${gpu.architecture} ${gpu.description}`.toLowerCase();
  return Boolean(gpu.isFallbackAdapter) || /swiftshader|llvmpipe|microsoft basic|warp|software/.test(text);
}

async function loadFixture(name) {
  const [wav, truth] = await Promise.all([
    fetch(`${FIXTURES}${name}.wav`).then((r) => r.arrayBuffer()),
    fetch(`${FIXTURES}${name}.words.json`).then((r) => (r.ok ? r.json() : null)),
  ]);
  return { name, samples: readWavPcm16Mono16k(wav), ground: truth, language: name.startsWith("en") ? "en" : "es" };
}

/** Any audio file the browser can decode → 16 kHz mono, the way the extension exports it (D6). */
async function loadUserFile(file, language) {
  const decoded = await new AudioContext().decodeAudioData(await file.arrayBuffer());
  const frames = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { name: file.name, samples: rendered.getChannelData(0), ground: null, language };
}

const SUFFIX = { fp32: "", fp16: "_fp16", q8: "_quantized", q4: "_q4", q4f16: "_q4f16" };

/** True when both ONNX files of this model+dtype are already in transformers.js' Cache API store. */
async function modelFilesCached(model, dtype) {
  const suffix = (file) => SUFFIX[typeof dtype === "string" ? dtype : dtype[file]];
  const cache = await caches.open("transformers-cache");
  const keys = new Set((await cache.keys()).map((r) => r.url));
  return ["encoder_model", "decoder_model_merged"].every((f) =>
    keys.has(`https://huggingface.co/${model}/resolve/main/onnx/${f}${suffix(f)}.onnx`),
  );
}

function dtypeOption(dtype) {
  return dtype === "mixed" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : dtype;
}

class WhisperWorker {
  constructor() {
    this.worker = new Worker(new URL(`./worker.js?vendor=${encodeURIComponent(VENDOR)}&nocache=${pageParams.get("nocache") ?? ""}`, import.meta.url), { type: "module" });
    this.waiting = null;
    this.chunkEvents = [];
    this.ready = new Promise((resolve) => (this.onReady = resolve));
    this.worker.onmessage = ({ data }) => {
      if (data.type === "ready") return this.onReady();
      if (data.type === "progress") return log(`  downloaded/cached ${data.file}`);
      if (data.type === "chunk") {
        this.chunkEvents.push(data);
        return log(`  chunk ${data.done}/${data.total} done at ${data.atSeconds.toFixed(1)} s`);
      }
      const w = this.waiting;
      this.waiting = null;
      if (!w) return;
      if (data.type === "error") w.reject(new Error(data.message));
      else w.resolve(data);
    };
    this.worker.onerror = (e) => this.waiting?.reject(new Error(e.message ?? "worker error"));
  }
  async call(message, transfer = []) {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.worker.postMessage(message, transfer);
    });
  }
  terminate() {
    this.worker.terminate();
  }
}

/**
 * Runs one configuration: load the model once, then each audio `repeats` times.
 * config: {model, device, dtype, threads, audios: [fixture names], repeats, clearCache, file?, language?}
 */
async function run(config) {
  const env = await getEnv();
  const audios = [];
  for (const name of config.audios ?? []) audios.push(await loadFixture(name));
  if (config.file) audios.push(await loadUserFile(config.file, config.language ?? "es"));

  if (config.clearCache) {
    await caches.delete("transformers-cache");
    log("cleared the transformers-cache");
  }
  const cached = await modelFilesCached(config.model, dtypeOption(config.dtype));
  const worker = new WhisperWorker();
  const rows = [];
  try {
    log(`loading ${config.model} on ${config.device} dtype=${JSON.stringify(dtypeOption(config.dtype))} threads=${config.threads}`);
    const loaded = await worker.call({
      type: "load",
      config: { model: config.model, device: config.device, dtype: dtypeOption(config.dtype), threads: config.threads },
    });
    const cache = cached ? "cached" : "cold (download)";
    log(`  loaded in ${loaded.loadSeconds.toFixed(1)} s (${cache}; files ${loaded.filesSeconds?.toFixed(1)} s, sessions ${loaded.sessionSeconds?.toFixed(1)} s) threads=${loaded.effectiveThreads} ${loaded.files.join(", ")}`);
    for (const audio of audios) {
      for (let i = 1; i <= (config.repeats ?? 2); i++) {
        const samples = audio.samples.slice(); // transferred, so copy per run
        worker.chunkEvents = [];
        const options = { timestamps: config.timestamps ?? "word", progress: Boolean(config.progress) };
        const out = await worker.call({ type: "transcribe", samples, language: audio.language, options }, [samples.buffer]);
        // Segment timestamps are only for timing the cost of word timestamps: nothing to score.
        const words = options.timestamps === "word" ? chunksToWords(out.chunks) : [];
        const audioSeconds = audio.samples.length / 16000;
        const row = {
          model: config.model,
          device: config.device,
          dtype: typeof dtypeOption(config.dtype) === "string" ? config.dtype : "enc fp32 + dec q4",
          threads: config.device === "wasm" ? loaded.effectiveThreads : "-",
          requestedThreads: config.threads,
          crossOriginIsolated: self.crossOriginIsolated,
          audio: audio.name,
          audioSeconds,
          run: i,
          loadSeconds: loaded.loadSeconds,
          loadFilesSeconds: loaded.filesSeconds,
          loadSessionSeconds: loaded.sessionSeconds,
          retries429: loaded.retries429,
          cache,
          modelMB: loaded.bytes / 1e6,
          transcribeSeconds: out.seconds,
          secondsPerAudioMinute: (out.seconds / audioSeconds) * 60,
          words: words.length,
          text: out.text,
          timestamps: options.timestamps,
          progressEvents: config.progress ? worker.chunkEvents.map((e) => `${e.done}/${e.total}@${e.atSeconds.toFixed(1)}s`) : undefined,
          ...(audio.ground && options.timestamps === "word" ? scoreWords(words, audio.ground) : {}),
          esto: audio.name === "es-short" && audio.ground ? estoCheck(words, audio.ground) : undefined,
          webgpuAdapter: config.device === "webgpu" ? env.webgpu : undefined,
          webgpuSoftware: config.device === "webgpu" ? isSoftwareAdapter(env.webgpu) : undefined,
          firstWords: words.slice(0, 8).map((w) => `${w.text.trim()}@${w.start}`).join(" "),
        };
        rows.push(row);
        results.push(row);
        addRow(row);
        log(`  ${audio.name} #${i}: ${out.seconds.toFixed(1)} s` + (row.wordAccuracy !== undefined ? `, acc ${(row.wordAccuracy * 100).toFixed(1)} %, start err ${row.medianStartErrorMs}/${row.p90StartErrorMs} ms` : ""));
      }
    }
  } finally {
    worker.terminate();
  }
  if (config.cachedReload) {
    // Same model again in a fresh worker: weights now come from the Cache API, so this is the
    // load time of every later transcription (new ONNX sessions, no download).
    const again = new WhisperWorker();
    try {
      const reloaded = await again.call({
        type: "load",
        config: { model: config.model, device: config.device, dtype: dtypeOption(config.dtype), threads: config.threads },
      });
      log(`  cached reload in ${reloaded.loadSeconds.toFixed(1)} s (files ${reloaded.filesSeconds?.toFixed(1)} s, sessions ${reloaded.sessionSeconds?.toFixed(1)} s)`);
      for (const row of rows) {
        row.cachedLoadSeconds = reloaded.loadSeconds;
        row.cachedLoadSessionSeconds = reloaded.sessionSeconds;
      }
    } finally {
      again.terminate();
    }
  }
  return { env, rows };
}

function addRow(r) {
  const tr = document.createElement("tr");
  const pct = r.wordAccuracy === undefined ? "" : `${(r.wordAccuracy * 100).toFixed(1)} %`;
  const cells = [
    r.model.replace("Xenova/", ""), r.device, r.dtype, r.threads, r.audio, r.run, r.loadSeconds.toFixed(1), r.cache,
    r.transcribeSeconds.toFixed(1), r.secondsPerAudioMinute.toFixed(1), pct,
    r.medianStartErrorMs ?? "", r.p90StartErrorMs ?? "",
    [r.webgpuSoftware ? "SOFTWARE ADAPTER: not representative" : "", r.esto ?? ""].filter(Boolean).join(" · "),
  ];
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = String(c);
    tr.append(td);
  }
  $("rows")?.append(tr);
}

async function showEnv() {
  const env = await getEnv();
  const soft = isSoftwareAdapter(env.webgpu);
  $("env").textContent =
    `crossOriginIsolated: ${env.crossOriginIsolated}   SharedArrayBuffer: ${env.sharedArrayBuffer}   cores: ${env.hardwareConcurrency}\n` +
    `WebGPU: ${typeof env.webgpu === "string" ? env.webgpu : JSON.stringify(env.webgpu)}` +
    (soft ? "\n  -> software adapter: WebGPU timings here are NOT representative of a real GPU" : "") +
    `\n${env.userAgent}` +
    (env.crossOriginIsolated ? "" : "\n  -> not crossOriginIsolated: ONNX Runtime will use 1 WASM thread whatever you pick");
}

if ($("run")) {
  showEnv();
  $("run").onclick = async () => {
    $("run").disabled = true;
    $("status").textContent = "running… (the first run downloads the model)";
    try {
      const file = $("file").files[0];
      await run({
        model: $("model").value,
        device: $("device").value,
        dtype: $("dtype").value,
        threads: Number($("threads").value),
        audios: file ? [] : [...$("audio").selectedOptions].map((o) => o.value),
        file,
        language: $("language").value,
        repeats: Number($("repeats").value),
        clearCache: $("cold").checked,
      });
      $("status").textContent = "done";
    } catch (err) {
      $("status").textContent = `failed: ${err.message}`;
      log(String(err.stack ?? err));
    } finally {
      $("run").disabled = false;
    }
  };
  $("copy").onclick = () => navigator.clipboard.writeText(JSON.stringify(results, null, 2));
}

window.spike = { getEnv, run, results };
