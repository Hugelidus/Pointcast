/**
 * Drives the spike page in headless Chromium (the repo's @playwright/test build) and records
 * timings, accuracy and peak memory per configuration.
 *
 *   node spikes/in-browser-whisper/runner.mjs --probe               # environment only
 *   node spikes/in-browser-whisper/runner.mjs --plan main           # the measured matrix
 *   node spikes/in-browser-whisper/runner.mjs --only base-wasm4-q8  # one named case
 *
 * Etiquette (the user works at this machine): headless only, --mute-audio, a temporary profile
 * of our own, and this process lowers its priority to BelowNormal before launching Chromium
 * (Windows children inherit the class) and proc.mjs holds every Chromium process there. WASM
 * threads never exceed 8 (4 in the main matrix). Ports 5531/5532.
 *
 * One Chromium launch per configuration, so the peak working set belongs to that configuration.
 * Default (memory mode): an incognito context, whose Cache API and HTTP cache live in RAM, so model
 * weights never touch the disk. The page loads the model cold (download), transcribes, then loads it
 * again in a new worker from the in-memory Cache API ("cached" load). --disk-profile instead keeps a
 * persistent profile on disk, whose Cache API survives between launches (what an extension gets).
 * Memory mode exists because this machine's C: drive was full during the spike (about 140 MB free).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startServer, resolveVendorDirs } from "./server.mjs";
import { chromiumMemory, freeDiskMB, holdBelowNormal, newMarker } from "./proc.mjs";

os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results");
const PORT_ISOLATED = 5531;
const PORT_PLAIN = 5532;
// Keep this path short: Chromium's Cache API files live ~150 characters deep inside the profile, and
// past Windows' 260-character MAX_PATH CacheStorage.open() fails with "Unexpected internal error".
const SCRATCH = process.env.SPIKE_SCRATCH ?? path.join(os.tmpdir(), "pcws");
const PROFILE = path.join(SCRATCH, "profile");
/** Marks this run's Chromium command line so its process tree can be found (unknown switches are ignored). */
const RUN_MARKER = newMarker();
/** Refuse to start a case below this much free disk space. */
const MIN_FREE_MB = 100;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE = "Xenova/whisper-base";
const TINY = "Xenova/whisper-tiny";
const SMALL = "Xenova/whisper-small";
const BOTH = ["es-short", "es-2min"];

/** name → config. `isolated:false` serves the page without COOP/COEP. */
const CASES = {
  // whisper-base (the CLI default)
  "base-wasm4-q8": { model: BASE, device: "wasm", dtype: "q8", threads: 4 },
  "base-wasm4-fp32": { model: BASE, device: "wasm", dtype: "fp32", threads: 4 },
  "base-wasm8-fp32": { model: BASE, device: "wasm", dtype: "fp32", threads: 8 },
  "base-wasm1-q8": { model: BASE, device: "wasm", dtype: "q8", threads: 1 },
  "base-wasm1-fp32": { model: BASE, device: "wasm", dtype: "fp32", threads: 1 },
  "base-wasm4-q8-notisolated": { model: BASE, device: "wasm", dtype: "q8", threads: 4, isolated: false },
  "base-webgpu-fp32": { model: BASE, device: "webgpu", dtype: "fp32" },
  "base-webgpu-fp16": { model: BASE, device: "webgpu", dtype: "fp16" },
  "base-webgpu-mixed": { model: BASE, device: "webgpu", dtype: "mixed" },
  // whisper-tiny
  "tiny-wasm4-q8": { model: TINY, device: "wasm", dtype: "q8", threads: 4 },
  "tiny-wasm4-fp32": { model: TINY, device: "wasm", dtype: "fp32", threads: 4 },
  "tiny-wasm1-q8": { model: TINY, device: "wasm", dtype: "q8", threads: 1 },
  "tiny-webgpu-fp32": { model: TINY, device: "webgpu", dtype: "fp32" },
  // whisper-small (if time allows)
  "small-wasm4-q8": { model: SMALL, device: "wasm", dtype: "q8", threads: 4 },
  "small-webgpu-fp16": { model: SMALL, device: "webgpu", dtype: "fp16" },
  "small-webgpu-fp32": { model: SMALL, device: "webgpu", dtype: "fp32" },
};

const PLANS = {
  smoke: ["tiny-wasm4-q8"],
  main: [
    "base-wasm4-q8", "base-wasm4-fp32", "base-wasm1-q8", "base-wasm1-fp32", "base-wasm4-q8-notisolated",
    "base-webgpu-fp32", "base-webgpu-fp16", "base-webgpu-mixed",
    "tiny-wasm4-q8", "tiny-wasm4-fp32", "tiny-wasm1-q8", "tiny-webgpu-fp32",
  ],
  small: ["small-wasm4-q8", "small-webgpu-fp16", "small-webgpu-fp32"],
};

function chromiumArgs() {
  return [
    "--mute-audio",
    RUN_MARKER,
    // Keep disk writes near zero (the incognito context already keeps caches in memory).
    "--disk-cache-size=1",
    "--disable-gpu-shader-disk-cache",
    // WebGPU is on by default in desktop Chrome; these only matter for headless GPU access.
    ...(flag("--gpu-flags") ? ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu"] : []),
  ];
}

async function launch() {
  const common = {
    channel: "chromium", // full browser in new headless mode (same GPU stack as headful)
    headless: true,
    args: chromiumArgs(),
  };
  if (flag("--disk-profile")) {
    mkdirSync(PROFILE, { recursive: true });
    return chromium.launchPersistentContext(PROFILE, { ...common, viewport: { width: 1200, height: 900 } });
  }
  const browser = await chromium.launch(common);
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  context.on("close", () => browser.close().catch(() => undefined));
  const close = context.close.bind(context);
  context.close = async () => {
    await close();
    await browser.close();
  };
  return context;
}

function watchNetwork(context) {
  const hosts = new Map();
  context.on("request", (req) => {
    const host = new URL(req.url()).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  });
  return hosts;
}

async function openPage(context, isolated) {
  const page = await context.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" || msg.type() === "warning" || text.startsWith("[spike]")) console.log(`    [page ${msg.type()}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => console.log(`    [pageerror] ${err.message}`));
  await page.goto(`http://localhost:${isolated ? PORT_ISOLATED : PORT_PLAIN}/spike/index.html`);
  await page.waitForFunction(() => window.spike !== undefined);
  return page;
}

async function probe() {
  const context = await launch();
  try {
    for (const isolated of [true, false]) {
      const page = await openPage(context, isolated);
      const env = await page.evaluate(() => window.spike.getEnv());
      console.log(`isolated=${isolated}`, JSON.stringify(env, null, 2));
      await page.close();
    }
  } finally {
    await context.close();
  }
}

async function runCase(name, repeats) {
  const base = CASES[name];
  if (!base) throw new Error(`unknown case ${name}`);
  // --no-reload: one model load only, so the peak memory is that of a single transcription job.
  const config = { ...base, audios: option("--audios")?.split(",") ?? BOTH, repeats, clearCache: flag("--cold"), cachedReload: !flag("--no-reload"), timestamps: option("--timestamps") ?? "word", progress: flag("--progress") };
  const isolated = base.isolated !== false;
  const freeBefore = freeDiskMB();
  if (freeBefore < MIN_FREE_MB) throw new Error(`only ${freeBefore} MB free on disk; not starting ${name}`);
  console.log(`\n=== ${name} ${JSON.stringify(config)}`);
  const context = await launch();
  const priority = holdBelowNormal(RUN_MARKER);
  const hosts = watchNetwork(context);
  const started = Date.now();
  try {
    const page = await openPage(context, isolated);
    const { env, rows } = await page.evaluate((c) => window.spike.run(c), config);
    const memory = chromiumMemory(RUN_MARKER);
    console.log(`  memory ${JSON.stringify(memory)}`);
    console.log(`  hosts ${JSON.stringify(Object.fromEntries(hosts))}`);
    return {
      case: name,
      storage: flag("--disk-profile") ? "disk profile" : "incognito (in-memory caches)",
      freeDiskMB: { before: freeBefore, after: freeDiskMB() },
      isolatedServer: isolated,
      wallSeconds: (Date.now() - started) / 1000,
      env,
      memory,
      hosts: Object.fromEntries(hosts),
      rows: rows.map(({ text, ...r }) => ({ ...r, textStart: text.slice(0, 120) })),
    };
  } finally {
    priority.stop();
    await context.close();
  }
}

function saveResult(result) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, "browser-runs.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { machine: machine(), vendor: vendorInfo(), runs: [] };
  all.runs.push({ at: new Date().toISOString(), ...result });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

function machine() {
  return `${os.cpus()[0]?.model.trim()}, ${os.cpus().length} logical cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${os.platform()} ${os.release()}`;
}

function vendorInfo() {
  const v = resolveVendorDirs();
  return { transformers: v.transformersVersion, onnxruntimeWeb: v.ortVersion, chromium: chromium.executablePath() };
}

async function main() {
  const servers = [await startServer({ port: PORT_ISOLATED, isolated: true }), await startServer({ port: PORT_PLAIN, isolated: false })];
  try {
    if (flag("--fresh-profile")) rmSync(PROFILE, { recursive: true, force: true });
    if (flag("--probe")) return await probe();
    const repeats = Number(option("--repeats") ?? 2);
    const names = option("--only")?.split(",") ?? PLANS[option("--plan") ?? "smoke"];
    for (const name of names) {
      try {
        const result = await runCase(name, repeats);
        saveResult(result);
        for (const r of result.rows) {
          console.log(
            `  ${r.audio.padEnd(8)} #${r.run} load ${r.loadSeconds.toFixed(1)}s (${r.cache}) transcribe ${r.transcribeSeconds.toFixed(1)}s ` +
              `(${r.secondsPerAudioMinute.toFixed(1)} s/min) cachedLoad ${r.cachedLoadSeconds?.toFixed(1)}s acc ${(r.wordAccuracy * 100).toFixed(1)}% err ${r.medianStartErrorMs}/${r.p90StartErrorMs} ms threads=${r.threads}`,
          );
        }
      } catch (err) {
        console.error(`  FAILED ${name}: ${err.message}`);
        saveResult({ case: name, error: String(err.message).slice(0, 2000) });
      }
    }
  } finally {
    for (const s of servers) s.close();
  }
}

await main();
