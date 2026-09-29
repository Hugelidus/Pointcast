import { browser } from "wxt/browser";
import { HANDOFF_PORT, MODEL_HOST, MODEL_PATH_TEMPLATE } from "../build-env";
import { copyFromOffscreenDocument } from "../clipboard";
import { sendMessage, type ProcessingResult } from "../messages";
import {
  liveTranscriptionThreads,
  TranscriptionWorker,
  transcribeInWorker,
  transcriptionThreads,
} from "../transcriber/client";
import type { EngineConfig } from "../transcriber/protocol";
import { speechModel, type TranscriptionQuality } from "../processing/speech-model";
import { decodeRecording } from "./audio";
import { deliver } from "./deliver";
import { resolveFromDevServer } from "./dev-server";
import { handOff, publishFiles } from "./handoff";
import { LiveTranscription } from "./live-transcription";
import type { MicrophoneRecording } from "./microphone-recording";
import { throttleProgress } from "../transcriber/throttle";
import { processSession, type ProcessingJob } from "./session-processor";

/**
 * Processes a stopped recording in this offscreen document and reports to the service worker:
 * progress while it runs, then the files to save, or that a running pointcast MCP server stored
 * them (D11). The blob: URLs stay valid until the service worker closes this document, which it
 * does once every download has completed.
 */
export async function runProcessing(job: ProcessingJob): Promise<void> {
  const report = throttleProgress((progress) => {
    // Progress is only for display: a lost update is harmless.
    sendMessage({ to: "background", type: "processing-progress", sessionId: job.sessionId, progress }).catch(() => undefined);
  });
  let result: ProcessingResult;
  try {
    result = await processAndPublish(job, report);
  } catch (error) {
    // A bug, not a transcription failure (those are handled in processSession): still end the
    // processing state now rather than at the service worker's timeout.
    const message = error instanceof Error ? error.message : String(error);
    result = { files: [], copied: false, audioMs: 0, error: "Processing failed unexpectedly, so nothing was saved.", errorDetail: message };
  } finally {
    // Frees the live worker when nothing was transcribed (no audio); a no-op after finish().
    job.live?.cancel();
  }
  await deliver(job.sessionId, result, {
    send: (sessionId, report) => sendMessage({ to: "background", type: "processing-done", sessionId, result: report }),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

async function processAndPublish(
  job: ProcessingJob,
  report: ReturnType<typeof throttleProgress>,
): Promise<ProcessingResult> {
  const processed = await processSession(job, {
    transcribe: async (samples, options) => {
      const { live } = job;
      if (live) {
        try {
          return await live.finish(samples, { ...options, quality: job.options.quality, onProgress: report });
        } catch (error) {
          console.warn("[pointcast] live transcription failed; transcribing the whole recording", error);
        }
      }
      return transcribeInWorker(
        {
          samples,
          ...(options.language ? { language: options.language } : {}),
          ...(options.fallbackLanguage ? { fallbackLanguage: options.fallbackLanguage } : {}),
          ...engineConfig(transcriptionThreads(navigator.hardwareConcurrency), job.options.quality),
        },
        { deadline: options.deadline, onProgress: report },
      );
    },
    copy: copyFromOffscreenDocument,
    // The page's own dev server, with the extension's host permissions: local dev hosts and the
    // sites the user enabled (the only pages events come from). Extension pages skip CORS there.
    resolveCode: (session) => resolveFromDevServer(session, { fetch: globalThis.fetch.bind(globalThis) }),
  });
  return publishFiles(job.sessionId, processed, job.options, {
    handOff: (sessionId, files) =>
      handOff(sessionId, files, { fetch: globalThis.fetch.bind(globalThis), port: HANDOFF_PORT, extensionId: browser.runtime.id }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
  });
}

/**
 * Starts transcribing at Record (D1 note 2026-09-27, live transcription): the model loads now,
 * and each finished piece of the recording is transcribed on at most 4 threads while the user keeps working.
 */
export function startLiveTranscription(
  recording: MicrophoneRecording,
  language: string | undefined,
  quality: TranscriptionQuality,
): LiveTranscription {
  const worker = new TranscriptionWorker(engineConfig(liveTranscriptionThreads(navigator.hardwareConcurrency), quality));
  return new LiveTranscription(
    {
      worker,
      audioSoFar: () => decodeRecording(recording.recordedSoFar()),
      recordedMs: () => Date.now() - recording.t0,
    },
    language,
    quality,
  );
}

function engineConfig(threads: number, quality: TranscriptionQuality): EngineConfig {
  const { id, dtype } = speechModel(quality);
  return {
    model: id,
    dtype,
    threads,
    wasmPaths: new URL("/ort/", location.href).href,
    ...(MODEL_HOST ? { remoteHost: MODEL_HOST } : {}),
    ...(MODEL_PATH_TEMPLATE ? { remotePathTemplate: MODEL_PATH_TEMPLATE } : {}),
  };
}
