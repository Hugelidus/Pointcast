import type { WordsFile } from "@pointcast/core";

/** Options common to every transcription engine. */
export interface TranscribeOptions {
  /** ISO 639-1 code, e.g. "es". When omitted, the local engine detects it on the first speech
   * (after skipping the leading silence every recording starts with, see D1) and refuses to
   * guess when unsure; OpenAI-compatible servers detect it themselves. */
  language?: string;
  /** Free-form hint text (e.g. the visible labels of captured elements) to bias vocabulary.
   * Not every engine can honor this — see each engine's own doc comment. */
  prompt?: string;
}

/**
 * A transcription backend. Every engine produces the same `WordsFile` shape, so fusion
 * (packages/core) never has to know which engine ran (D1: the API engine exists for people
 * who want speed/quality over locality, not to add a second data shape).
 *
 * Implementations: `LocalTranscriptionEngine` here (Node and browser), and the CLI's
 * OpenAI-compatible engine (packages/cli/src/transcribe/openai.ts).
 */
export interface TranscriptionEngine {
  /** Short identifier, e.g. "local:Xenova/whisper-base" — stored verbatim in WordsFile.engine. */
  name: string;
  /** `samples`: 16 kHz mono PCM as floats in [-1, 1], sample 0 being t0 (session-format.md). */
  transcribe(samples: Float32Array, opts: TranscribeOptions): Promise<WordsFile>;
}

/**
 * What the local engine is doing, for a progress display (the extension's popup). One engine
 * loads its model once, so the `loading-model` → `model-ready` events come only the first time;
 * every `transcribe()` call then reports its own stages.
 */
export type TranscriptionProgress =
  /**
   * Model files are being read: downloaded the first time, from the cache afterwards (the
   * library does not say which). Bytes are summed over all the model's files. `totalBytes` is 0
   * until the library knows the file sizes, and stays 0 if it cannot find out.
   */
  | { stage: "loading-model"; model: string; loadedBytes: number; totalBytes: number }
  /** The model is loaded; later `transcribe()` calls reuse it. */
  | { stage: "model-ready"; model: string }
  /** No language was given, so the engine is scoring the first 30 s of speech (under a second). */
  | { stage: "detecting-language" }
  /**
   * Whisper works in 30 s chunks; reported with `chunksDone: 0` when it starts, then after each
   * chunk. The last chunk is often shorter, so time is roughly, not exactly, proportional.
   */
  | { stage: "transcribing"; language: string; chunksDone: number; chunksTotal: number }
  /** `words` is the number of words in the result. No `language` when nothing was said and none was given. */
  | { stage: "done"; language?: string; words: number };

export type TranscriptionProgressListener = (progress: TranscriptionProgress) => void;
