import { LocalTranscriptionEngine, TranscriptionError } from "@pointcast/transcribe";
import { transcribeWithFallback } from "./language";
import type { WorkerJob, WorkerMessage } from "./protocol";
import { retryOn429 } from "./retry-fetch";

/**
 * Module worker spawned by the offscreen document for ONE recording (client.ts). It runs in a
 * worker so the offscreen document stays responsive while Whisper uses every thread it was
 * given. The engine is created by the first job and reused by the next ones (live transcription
 * sends one per piece of audio); the worker is terminated afterwards, which is what frees ONNX
 * Runtime's memory.
 *
 * Code comes only from the extension (MV3 forbids remote code): transformers.js is bundled, and
 * ONNX Runtime's .mjs/.wasm are served from public/ort/ via `wasmPaths`. Model weights are data:
 * they come from Hugging Face the first time and from the Cache API afterwards.
 */

// The extension's tsconfig has the DOM lib, not WebWorker: name only what a worker scope offers.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerJob>) => void) | null;
  postMessage(message: WorkerMessage): void;
};

let engine: LocalTranscriptionEngine | undefined;
/** Jobs run one after the other, so answers come back in the order the jobs were sent. */
let queue = Promise.resolve();

scope.onmessage = ({ data: job }) => {
  queue = queue.then(() => run(job));
};

async function run(job: WorkerJob): Promise<void> {
  try {
    engine ??= new LocalTranscriptionEngine({
      model: job.model,
      dtype: job.dtype,
      threads: job.threads,
      wasmPaths: job.wasmPaths,
      remoteHost: job.remoteHost,
      remotePathTemplate: job.remotePathTemplate,
      fetch: retryOn429((input, init) => fetch(input, init)),
      onProgress: (progress) => scope.postMessage({ type: "progress", progress }),
    });
    // Instant once loaded: a job after the preload reports loadMs 0.
    const loadStart = performance.now();
    await engine.preload();
    const transcribeStart = performance.now();
    const loadMs = Math.round(transcribeStart - loadStart);
    if (job.type === "preload") {
      scope.postMessage({ type: "ready", loadMs });
      return;
    }
    const { words, fallback } = await transcribeWithFallback(engine, job.samples, job.language, job.fallbackLanguage);
    scope.postMessage({
      type: "done",
      words,
      ...(fallback ? { fallback } : {}),
      loadMs,
      transcribeMs: Math.round(performance.now() - transcribeStart),
    });
  } catch (error) {
    // Errors do not survive postMessage as classes: send the code and the message.
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof TranscriptionError ? { code: error.code } : {}),
    });
  }
}
