import type { TimeSpan, Word } from "@pointcast/core";
import type { TranscriptionProgress } from "@pointcast/transcribe";
// The subpath, not the package: its entry point would pull transformers.js (and a second copy of
// ONNX Runtime's 27 MB .wasm) into the offscreen document, which only needs these pure functions.
import { findCut, joinSegments, joinUnreliable, MIN_SEGMENT_S } from "@pointcast/transcribe/segments";
import { beforeDeadline, type TranscriptionWorker } from "../transcriber/client";
import type { TranscribeDone } from "../transcriber/protocol";
import type { TranscriptionQuality } from "../processing/speech-model";
import { AUDIO_FILE } from "./session-file";

/** How often the recording is checked for a place to cut. */
const POLL_MS = 2_000;
/**
 * Live transcription covers the first 20 minutes; Stop transcribes the rest. Each check decodes
 * the whole recording so far (see audioSoFar), so its cost grows with the recording and the total
 * with its square: a 60-minute recording would decode about 40 hours of audio, with a 16 kHz
 * copy of everything each time, next to the ~1 GB model. Past the limit, the recording stays
 * safe and the wait after Stop grows instead.
 */
export const LIVE_LIMIT_S = 20 * 60;
const RATE = AUDIO_FILE.sampleRate;

export interface LiveDeps {
  worker: Pick<TranscriptionWorker, "preload" | "transcribe" | "terminate" | "onProgress">;
  /** Everything recorded so far as 16 kHz mono, decoded exactly like the whole recording at Stop. */
  audioSoFar(): Promise<Float32Array>;
  /** Wall-clock length of the recording so far, in ms: no decoding until a cut is possible. */
  recordedMs(): number;
}

export interface FinishOptions {
  /** The language chosen in the popup at Stop; undefined means detect it. */
  language?: string;
  /** The previous session's language, for a recording short enough to be a single piece. */
  fallbackLanguage?: string;
  /** Settings.quality at Stop: another model than the one loaded at Record means starting over. */
  quality: TranscriptionQuality;
  /** Epoch ms after which transcription is abandoned. */
  deadline: number;
  /** From now on, the worker's progress goes here: the user is waiting. */
  onProgress: (progress: TranscriptionProgress) => void;
}

/**
 * Transcribes a recording while it is being made (D1 note 2026-09-27, live transcription): the
 * model loads at Record, every finished 15-30 s piece (cut in a pause, see segments.ts in
 * @pointcast/transcribe) is transcribed in the background on the worker, and after Stop only the
 * last piece is left.
 *
 * Any problem (a decode that fails, a worker error, a language the engine is not sure about, a
 * language or transcription quality changed in the popup during the recording) makes finish() throw, and the caller
 * transcribes the whole recording in one go as before: a problem here costs time, never the
 * transcript.
 */
export class LiveTranscription {
  /** Sample where the next piece starts: everything before it is transcribed or queued. */
  #from = 0;
  /** Sample up to which transcription has finished, for the time estimate at Stop. */
  #doneUntil = 0;
  /** The user's choice, or what the engine detected in the first piece. */
  #language: string | undefined;
  #engine = "";
  #loadMs = 0;
  #modelLoaded = false;
  readonly #pieces: { startSample: number; words: Word[]; unreliable?: TimeSpan[] }[] = [];
  /** Pieces are transcribed one after the other, in recording order. Never rejects. */
  #queue: Promise<unknown>;
  #failure: unknown;
  #polling: Promise<void> | undefined;
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly deps: LiveDeps,
    /** The language chosen in the popup at Record; undefined means detect it. */
    private readonly startLanguage: string | undefined,
    /** The transcription quality at Record: the model the worker loads. */
    private readonly startQuality: TranscriptionQuality = "fast",
  ) {
    this.#language = startLanguage;
    this.#queue = deps.worker.preload().then(
      (ms) => {
        this.#loadMs = ms;
        this.#modelLoaded = true;
      },
      (error: unknown) => (this.#failure ??= error),
    );
    this.#timer = setInterval(() => {
      this.#polling ??= this.#poll().finally(() => (this.#polling = undefined));
    }, POLL_MS);
  }

  /**
   * Whether the model finished loading during the recording. Its progress reports went nowhere
   * (nobody was waiting), so after Stop there is no "model-ready" report to move the popup past
   * "Downloading the speech model".
   */
  get modelLoaded(): boolean {
    return this.#modelLoaded;
  }

  /** Audio recorded but not transcribed yet, in ms, for the estimate shown after Stop. */
  pendingMs(totalMs: number): number {
    return Math.max(0, totalMs - Math.round((this.#doneUntil * 1000) / RATE));
  }

  /**
   * After Stop: transcribes what is left of `samples` (the whole recording, decoded) and joins it
   * to the pieces done so far. Always ends the worker.
   */
  async finish(samples: Float32Array, options: FinishOptions): Promise<TranscribeDone> {
    clearInterval(this.#timer);
    try {
      await this.#polling;
      if (this.#failure !== undefined) throw this.#failure;
      if (options.language !== this.startLanguage) throw new Error("the language was changed during the recording");
      if (options.quality !== this.startQuality) throw new Error("the transcription quality was changed during the recording");
      if (samples.length <= this.#from) throw new Error("the recording is shorter than what was transcribed");
      this.deps.worker.onProgress = options.onProgress;
      const tail = samples.slice(this.#from);
      // A recording that is one piece is transcribed exactly as the one-shot path would.
      const whole = this.#from === 0 ? { fallbackLanguage: options.fallbackLanguage } : undefined;
      const last = await beforeDeadline(this.#enqueue(tail, this.#from, whole), options.deadline);
      if (!last) throw this.#failure;
      const unreliable = joinUnreliable(this.#pieces);
      return {
        type: "done",
        ...(last.fallback ? { fallback: last.fallback } : {}),
        words: {
          schemaVersion: 1,
          engine: this.#engine,
          language: this.#language,
          words: joinSegments(this.#pieces),
          ...(unreliable.length > 0 ? { unreliable } : {}),
        },
        loadMs: this.#loadMs,
        transcribeMs: last.transcribeMs,
        audioMs: Math.round((tail.length * 1000) / RATE),
      };
    } finally {
      this.deps.worker.terminate();
    }
  }

  /** Stops everything without a result (the recording could not be decoded, or was empty). */
  cancel(): void {
    clearInterval(this.#timer);
    this.deps.worker.terminate();
  }

  async #poll(): Promise<void> {
    if (this.#failure !== undefined) return;
    if (this.#from >= LIVE_LIMIT_S * RATE) {
      clearInterval(this.#timer);
      return;
    }
    // Decoding the whole recording costs a little CPU: only when a cut is possible.
    if (this.deps.recordedMs() < ((this.#from / RATE) + MIN_SEGMENT_S + 1) * 1000) return;
    try {
      const samples = await this.deps.audioSoFar();
      const cut = findCut(samples, this.#from);
      if (cut === undefined) return;
      this.#enqueue(samples.slice(this.#from, cut), this.#from);
      this.#from = cut;
    } catch (error) {
      this.#failure ??= error;
    }
  }

  /**
   * Queues one piece; resolves with its result, or undefined once anything has failed. `whole`
   * marks a piece that is the entire recording: only then may the engine fall back to another
   * language when unsure, as the one-shot path does.
   */
  #enqueue(
    samples: Float32Array,
    startSample: number,
    whole?: { fallbackLanguage: string | undefined },
  ): Promise<TranscribeDone | undefined> {
    const piece = this.#queue.then(async () => {
      if (this.#failure !== undefined) return undefined;
      try {
        const done = await this.deps.worker.transcribe({
          samples,
          ...(this.#language ? { language: this.#language } : {}),
          ...(whole?.fallbackLanguage ? { fallbackLanguage: whole.fallbackLanguage } : {}),
        });
        // Unsure of the language of a first piece: the one-shot path decides on the whole recording.
        if (done.fallback && !whole) throw new Error("the language of the first piece was uncertain");
        this.#language ??= done.words.language;
        this.#engine = done.words.engine;
        this.#pieces.push({ startSample, words: done.words.words, unreliable: done.words.unreliable });
        this.#doneUntil = startSample + samples.length;
        return done;
      } catch (error) {
        this.#failure ??= error;
        return undefined;
      }
    });
    this.#queue = piece;
    return piece;
  }
}
