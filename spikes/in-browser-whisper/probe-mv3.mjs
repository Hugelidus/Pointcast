/**
 * MV3 probe: loads three throwaway unpacked extensions into headless Chromium and checks, from
 * inside real extension contexts, what in-extension transcription needs. Each extension contains
 * this spike's page and worker unchanged, plus the vendor files, at the same paths as server.mjs.
 *
 *   node spikes/in-browser-whisper/probe-mv3.mjs [--run] [--webgpu-dtype fp32]
 *
 * Variants (manifest differences only):
 *   iso        cross_origin_embedder_policy require-corp + cross_origin_opener_policy same-origin
 *   plain      no isolation keys (what pointcast's manifest has today)
 *   strict-csp iso + extension_pages CSP without 'wasm-unsafe-eval' (is it in the default?)
 *   iso-wasm   iso + the documented default CSP declared explicitly ('wasm-unsafe-eval')
 *   plain-wasm plain + the same explicit CSP (multi-threading without cross-origin isolation?)
 * With --run, the iso-wasm offscreen document transcribes es-short and es-2min (WASM 4 threads fp32, then
 * WebGPU), and the plain-wasm one tries 4 threads without cross-origin isolation.
 *
 * Files are hard-linked into %TEMP%\pcwx (no extra disk space: C: was full during the spike), the
 * weights stay in memory (?nocache=1), and everything is deleted at the end.
 */
import { cpSync, linkSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { resolveVendorDirs } from "./server.mjs";
import { chromiumMemory, freeDiskMB, holdBelowNormal, newMarker } from "./proc.mjs";

os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ROOT = path.join(os.tmpdir(), "pcwx"); // short: see the MAX_PATH note in runner.mjs
const args = process.argv.slice(2);
const option = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const ISOLATION = {
  cross_origin_embedder_policy: { value: "require-corp" },
  cross_origin_opener_policy: { value: "same-origin" },
};
/** The CSP the docs list as the MV3 default, declared explicitly. */
const WASM_CSP = { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" };
const VARIANTS = {
  iso: { ...ISOLATION, permissions: ["offscreen", "unlimitedStorage"] },
  "iso-wasm": { ...ISOLATION, permissions: ["offscreen"], content_security_policy: WASM_CSP },
  "plain-wasm": { permissions: ["offscreen"], content_security_policy: WASM_CSP },
  plain: { permissions: ["offscreen"] },
  "strict-csp": {
    ...ISOLATION,
    permissions: ["offscreen"],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  },
};

function link(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true });
  try {
    linkSync(src, dst);
  } catch {
    cpSync(src, dst); // different volume: fall back to a copy
  }
}

function buildExtension(name, manifestExtra) {
  const dir = path.join(ROOT, name);
  const vendor = resolveVendorDirs();
  for (const f of ["background.js", "offscreen.html", "offscreen.js", "checks.js", "echo-worker.js", "gpu-worker.js"]) {
    link(path.join(HERE, "mv3-probe", f), path.join(dir, "mv3-probe", f));
  }
  for (const f of ["index.html", "app.js", "worker.js", "score.mjs"]) link(path.join(HERE, f), path.join(dir, "spike", f));
  link(path.join(vendor.transformers, "transformers.js"), path.join(dir, "vendor", "transformers", "transformers.js"));
  for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
    link(path.join(vendor.ort, f), path.join(dir, "vendor", "ort", f));
  }
  for (const f of ["es-short.wav", "es-short.words.json", "es-2min.wav", "es-2min.words.json"]) {
    link(path.join(REPO, "fixtures", "audio", f), path.join(dir, "fixtures", "audio", f));
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        name: `pcws-probe-${name}`,
        version: "0.0.1",
        background: { service_worker: "mv3-probe/background.js", type: "module" },
        ...manifestExtra,
      },
      null,
      2,
    ),
  );
  return dir;
}

async function main() {
  if (freeDiskMB() < 100) throw new Error(`only ${freeDiskMB()} MB free on disk`);
  rmSync(ROOT, { recursive: true, force: true });
  const dirs = Object.fromEntries(Object.entries(VARIANTS).map(([name, extra]) => [name, buildExtension(name, extra)]));
  const marker = newMarker();
  const context = await chromium.launchPersistentContext(path.join(ROOT, "profile"), {
    channel: "chromium",
    headless: true,
    args: [
      "--mute-audio",
      marker,
      "--disk-cache-size=1",
      "--disable-gpu-shader-disk-cache",
      `--disable-extensions-except=${Object.values(dirs).join(",")}`,
      `--load-extension=${Object.values(dirs).join(",")}`,
    ],
  });
  const priority = holdBelowNormal(marker);
  const report = { at: new Date().toISOString(), chromium: chromium.executablePath(), variants: {} };
  try {
    // One service worker per extension; name them by their manifest.
    const deadline = Date.now() + 15_000;
    while (context.serviceWorkers().length < Object.keys(VARIANTS).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const workers = {};
    for (const sw of context.serviceWorkers()) {
      const name = await sw.evaluate(() => chrome.runtime.getManifest().name);
      workers[name.replace("pcws-probe-", "")] = sw;
    }
    for (const name of Object.keys(VARIANTS)) {
      const sw = workers[name];
      if (!sw) {
        report.variants[name] = { error: "extension did not start" };
        continue;
      }
      const id = new URL(sw.url()).host;
      const entry = { id, manifest: VARIANTS[name] };
      entry.serviceWorker = await sw.evaluate(() => self.serviceWorkerChecks());
      const tab = await context.newPage();
      tab.on("console", (m) => m.type() === "error" && console.log(`  [${name} tab] ${m.text().slice(0, 700)}`));
      await tab.goto(`chrome-extension://${id}/spike/index.html?nocache=1`);
      entry.extensionTab = await tab.evaluate(async () => (await import("/mv3-probe/checks.js")).runChecks());
      await tab.close();
      const offscreen = await sw.evaluate(() => self.probeOffscreen("checks"));
      entry.offscreen = offscreen.ok ? offscreen.result : offscreen;
      report.variants[name] = entry;
      console.log(`\n== ${name}\n${JSON.stringify(entry, null, 1)}`);
    }

    if (args.includes("--run")) {
      const runs = [
        ["iso-wasm", { model: "Xenova/whisper-base", device: "wasm", dtype: "fp32", threads: 4, audios: ["es-short", "es-2min"], repeats: 1 }],
        ["iso-wasm", { model: "Xenova/whisper-base", device: "webgpu", dtype: option("--webgpu-dtype", "fp32"), audios: ["es-short", "es-2min"], repeats: 1 }],
        ["plain-wasm", { model: "Xenova/whisper-base", device: "wasm", dtype: "fp32", threads: 4, audios: ["es-short", "es-2min"], repeats: 1 }],
      ];
      report.runs = [];
      for (const [name, config] of runs) {
        if (freeDiskMB() < 100) throw new Error(`only ${freeDiskMB()} MB free on disk`);
        console.log(`\n== offscreen run in ${name}: ${JSON.stringify(config)}`);
        const res = await workers[name].evaluate((c) => self.probeOffscreen("run", c), config);
        if (!res.ok) {
          console.log(`  failed: ${res.error}`);
          report.runs.push({ variant: name, config, error: res.error });
          continue;
        }
        const rows = res.result.rows.map(({ text, ...r }) => r);
        for (const r of rows) {
          console.log(
            `  ${r.audio} load ${r.loadSeconds.toFixed(1)} s transcribe ${r.transcribeSeconds.toFixed(1)} s ` +
              `acc ${(r.wordAccuracy * 100).toFixed(1)} % err ${r.medianStartErrorMs}/${r.p90StartErrorMs} ms threads=${r.threads} coi=${r.crossOriginIsolated}`,
          );
        }
        report.runs.push({ variant: name, config, rows });
      }
      report.memory = chromiumMemory(marker);
    }
  } finally {
    priority.stop();
    await context.close();
    rmSync(ROOT, { recursive: true, force: true });
  }
  const out = path.join(HERE, "results", "mv3-probe.json");
  mkdirSync(path.dirname(out), { recursive: true });
  const previous = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
  writeFileSync(out, `${JSON.stringify([...[previous].flat(), report], null, 2)}\n`);
  console.log(`\nwrote ${out}`);
}

await main();
