import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import { LOCAL_HOST_MATCHES } from "./src/hosts";
import { OPTIONAL_SITE_MATCHES } from "./src/sites";
import { SUGGESTED_TOGGLE_SHORTCUT, SUGGESTED_UNDO_SHORTCUT, TOGGLE_RECORDING_COMMAND, UNDO_EVENT_COMMAND } from "./src/shortcut";

/**
 * ONNX Runtime's WASM build as transformers.js loads it in a browser: the "asyncify" variant of
 * the onnxruntime-web version that the resolved transformers.js depends on. The library would
 * fetch these from jsDelivr, which MV3 forbids (no remote code), so the extension ships them in
 * ort/ and the worker points `wasmPaths` there. Resolved from node_modules at build time, so the
 * files always match the library version instead of being a committed copy that can drift.
 */
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

function onnxRuntimeDistDir(): string {
  // Same resolution as the bundle: @pointcast/transcribe imports transformers.js, which imports
  // onnxruntime-web. Its main entry lives in dist/, next to the WASM files.
  const fromTranscribe = createRequire(fileURLToPath(new URL("../transcribe/package.json", import.meta.url)));
  const fromTransformers = createRequire(fromTranscribe.resolve("@huggingface/transformers"));
  return path.dirname(fromTransformers.resolve("onnxruntime-web"));
}

/**
 * onnxruntime-web's bundle also names its .wasm with `new URL(..., import.meta.url)`, so Vite
 * emits a second, hashed 27 MB copy under assets/. That copy is never loaded: the worker always
 * sets `wasmPaths` to ort/, and without it transformers.js would point at jsDelivr instead.
 * Dropping it halves the size of the extension.
 */
function dropBundledOrtWasm() {
  return {
    name: "pointcast:drop-bundled-ort-wasm",
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      for (const fileName of Object.keys(bundle)) {
        if (/^assets\/ort-wasm-.*\.wasm$/.test(fileName)) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  srcDir: "src",
  // Explicit imports instead of WXT's auto-imports: every file shows where its
  // helpers come from, which keeps the code readable without knowing WXT's magic.
  imports: false,
  manifest: {
    name: "pointcast",
    description: "Talk and point at your web app: your coding agent gets a spec with the exact elements and the code behind them.",
    // storage: state machine in chrome.storage.session (D6), settings in chrome.storage.local.
    // offscreen: the only long-lived context that can hold a MediaRecorder (D6), and the one
    // that transcribes, fuses and copies the Markdown (D1 note 2026-09-27).
    // downloads: the only way an extension can write files to disk (D6).
    // scripting: inject the content script into local tabs that were open before the extension
    // was installed or reloaded; Chrome only injects manifest scripts into later page loads (D6).
    // Also registers the content scripts of the sites the user enabled (D8 note 2026-09-27).
    // notifications: "copied" / "failed" when processing ends, for a user who looked away.
    // alarms: the processing timeout; a service worker's setTimeout dies with the worker (D6).
    // unlimitedStorage: the Whisper model (291 MB) lives in the Cache API.
    // activeTab: when the user opens the popup, it may read the active tab's URL, so it can
    // offer "Enable on <host>" for that site; no access to any other tab or site (D8 note).
    permissions: ["storage", "offscreen", "downloads", "scripting", "notifications", "alarms", "unlimitedStorage", "activeTab"],
    // Local hosts also let the offscreen document read the app's source from its own Vite dev
    // server at Stop, in memory, for the code pointer's `text at:` lines (D9 note, route 3).
    host_permissions: [...LOCAL_HOST_MATCHES],
    // Any other site only when the user enables it, one host at a time, from the popup; Chrome
    // asks them first. Declared optional, so installing grants nothing beyond local hosts (D8).
    optional_host_permissions: [...OPTIONAL_SITE_MATCHES],
    action: { default_title: "pointcast" },
    // ONNX Runtime compiles WebAssembly, which extension pages refuse without 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Cross-origin isolation gives extension pages SharedArrayBuffer, which multi-threaded WASM
    // needs; without it Whisper runs on one thread (spikes/in-browser-whisper, D1 note).
    cross_origin_embedder_policy: { value: "require-corp" },
    cross_origin_opener_policy: { value: "same-origin" },
    // Record/Stop without opening the popup; the service worker handles it (background/shortcut.ts).
    commands: {
      [TOGGLE_RECORDING_COMMAND]: {
        suggested_key: { default: SUGGESTED_TOGGLE_SHORTCUT },
        description: "Start or stop recording",
      },
      [UNDO_EVENT_COMMAND]: {
        suggested_key: { default: SUGGESTED_UNDO_SHORTCUT },
        description: "Undo the last pointing gesture",
      },
    },
  },
  // `pnpm zip` names the file after the product, pointcast-<version>-chrome.zip, not after the
  // workspace package (@pointcast/extension would give "pointcastextension-…").
  zip: { name: "pointcast" },
  // The transcription worker imports transformers.js, which loads code with dynamic import():
  // only an ES module worker can do that (Vite's default worker format is a classic script).
  vite: () => ({ worker: { format: "es", plugins: () => [dropBundledOrtWasm()] } }),
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      const dir = onnxRuntimeDistDir();
      for (const file of ORT_FILES) files.push({ absoluteSrc: path.join(dir, file), relativeDest: `ort/${file}` });
    },
  },
});
