import type { WordsFile } from "@pointcast/core";
import type { TranscriptionErrorCode, TranscriptionProgress } from "@pointcast/transcribe";

/**
 * Messages between the offscreen document and a transcription worker (client.ts). A worker
 * serves one recording: a single job after Stop, or, while recording, a preload and one job per
 * piece of audio (offscreen/live-transcription.ts). Jobs are answered in the order they were
 * sent. The worker is terminated afterwards: ONNX Runtime's WASM memory (about 1 GB for
 * whisper-base) is only given back to the system when the worker goes away.
 */

/** How to set up the engine; it has no extension APIs, so the offscreen document fills this in. */
export interface EngineConfig {
  threads: number;
  /** URL prefix of the ONNX Runtime files the extension ships (public/ort/). */
  wasmPaths: string;
  remoteHost?: string;
  remotePathTemplate?: string;
}

/** Loads the model ahead of the first job; answered with "ready". */
export interface PreloadJob extends EngineConfig {
  type: "preload";
}

export interface TranscribeJob extends EngineConfig {
  type: "transcribe";
  /** 16 kHz mono PCM, sample 0 being t0 (or the start of the piece). */
  samples: Float32Array;
  /** The user's choice; undefined means detect it. */
  language?: string;
  /** Used when detection is unsure: the language of the previous session. */
  fallbackLanguage?: string;
}

export type WorkerJob = PreloadJob | TranscribeJob;

/** Set when auto-detection was unsure and another language was used instead (language.ts). */
export interface LanguageFallback {
  /** What detection thought, and how sure it was (0..1). */
  guess: { code: string; probability: number };
  /** The language the transcript was made in. */
  used: string;
  /** "last-used": the previous session's language; "best-guess": there was none, so the guess. */
  reason: "last-used" | "best-guess";
}

export interface TranscribeDone {
  type: "done";
  words: WordsFile;
  fallback?: LanguageFallback;
  /** Model download or cache read plus session creation, in ms. */
  loadMs: number;
  /** Language detection and transcription, in ms. */
  transcribeMs: number;
  /**
   * Length of the audio transcribed in `transcribeMs`, when that is not the whole recording:
   * with live transcription only the last piece is left after Stop.
   */
  audioMs?: number;
}

export type WorkerMessage =
  | { type: "progress"; progress: TranscriptionProgress }
  | { type: "ready"; loadMs: number }
  | TranscribeDone
  | { type: "error"; message: string; code?: TranscriptionErrorCode };
