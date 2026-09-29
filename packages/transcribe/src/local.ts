import { pipeline, env, Tensor } from "@huggingface/transformers";
import type {
  AutomaticSpeechRecognitionPipeline,
  DataType,
  DeviceType,
  ProgressInfo,
} from "@huggingface/transformers";
import type { Word, WordsFile } from "@pointcast/core";
import { countChunks, SAMPLE_RATE } from "./chunks";
import { TranscriptionError } from "./errors";
import { pickLanguage, requireConfidentLanguage, speechStartSample, type LanguageGuess } from "./language";
import { dropReemittedWords } from "./monotonic";
import { sanitizeWords } from "./sanitize";
import { CompactedSpeech, rangesToMs, regionsToTranscribe, speechRegions, type SampleRange } from "./speech";
import type { TranscribeOptions, TranscriptionEngine, TranscriptionProgressListener } from "./types";
import { SileroVad } from "./vad";

/**
 * Everything that differs between the CLI (Node) and the extension (a browser worker) comes in
 * here, so this file never has to know where it runs. Every field is optional: the defaults are
 * the CLI's.
 *
 * `threads`, `wasmPaths`, `remoteHost`, `remotePathTemplate` and `fetch` set transformers.js' global
 * `env`, so they apply to every engine in the same process or worker. One engine per process is
 * the normal case for both callers.
 */
export interface LocalEngineOptions {
  /** A multilingual Whisper ONNX repo id with cross-attention outputs. Default "Xenova/whisper-base". */
  model?: string;
  /**
   * Weights precision, for every ONNX file or per file ({ encoder_model, decoder_model_merged }).
   * Default: defaultDtype(model).
   */
  dtype?: WeightsDtype;
  /** Default: the library's choice, "cpu" in Node and "wasm" in a browser. */
  device?: DeviceType;
  /** ONNX thread count. Unset lets onnxruntime pick (every core in Node: set it to stay polite). */
  threads?: number;
  /**
   * URL prefix (ending in "/") of ONNX Runtime's .wasm/.mjs files. Unset, transformers.js loads
   * them from jsDelivr, which an extension's CSP does not allow, so the extension serves its own
   * copy. A plain string, not {wasm, mjs}: that form makes the library import a blob: URL, which
   * extension pages also refuse (dev/spikes/in-browser-whisper).
   */
  wasmPaths?: string;
  /** Where model files are downloaded from. Default: the Hugging Face Hub. */
  remoteHost?: string;
  /** Appended to `remoteHost`; the library fills in {model} and {revision}. */
  remotePathTemplate?: string;
  /**
   * The fetch the library downloads model files with. Default: the global fetch. The extension
   * passes one that waits and retries when Hugging Face answers 429 (rate limited).
   */
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /** Seconds per chunk for audio longer than this; 0 disables chunking. Default 30. */
  chunkLengthS?: number;
  /** Overlap between consecutive chunks in seconds. Default chunkLengthS / 6 (the library's own). */
  strideLengthS?: number;
  /** Called with model download progress and each stage of a transcription (types.ts). */
  onProgress?: TranscriptionProgressListener;
  /**
   * Find the speech first (Silero VAD, vad.ts) and transcribe only that. Default true; false
   * transcribes everything, as before 2026-09-28, for comparisons. If the VAD model cannot be
   * loaded, the engine says so once and transcribes everything too: the VAD protects the
   * transcript, it must not prevent one.
   */
  vad?: boolean;
}

/**
 * Xenova/whisper-base, not an onnx-community equivalent: word-level timestamps need
 * cross-attentions in the ONNX export (`_extract_token_timestamps` in the library), and at
 * least onnx-community/whisper-tiny's export omits them ("Model outputs must contain cross
 * attentions to extract timestamps" — confirmed by hand while wiring this up). The Xenova
 * org's whisper exports were built for transformers.js from the start and do include them.
 *
 * Why base (dev/scripts/bench/results.json, 2026-09-26, 152 s Spanish fixture, 4 threads): 93 % of
 * words right, word starts within 165 ms median / 265 ms p90, transcribed in 24 s. That meets
 * plan step 3's "under 60 s" with room to spare. tiny is less accurate (87 %); small (96 %,
 * 66 s) and large-v3-turbo (96 %, 122 s) miss the budget and do not time words any better.
 * Since 2026-09-29, small is the extension's "Accurate" choice and the CLI's `--model
 * Xenova/whisper-small`, for users who trade time for fewer misheard words (D1 note).
 */
export const DEFAULT_MODEL = "Xenova/whisper-base";
export const DEFAULT_DTYPE: DataType = "fp32";

/** One precision for every ONNX file of the model, or one per file. */
export type WeightsDtype = DataType | Record<string, DataType>;

/**
 * The precision each model runs at unless told otherwise (D1 note 2026-09-29, measured on the
 * 152 s Spanish fixture with the VAD, 4 threads, dev/scripts/bench/results-2026-09-29.json):
 * - whisper-base: fp32. q8 was slower in the browser and less accurate (91 % vs 93 % of words).
 * - whisper-small: fp32 encoder, q8 decoder. Same words as all-fp32 (96.2 % in Node) for 512 MB
 *   instead of 971 MB, and a cached load in the browser of 5.5 s instead of 15 s. All-q8 (252 MB)
 *   lost its word times on a quarter of the fixture: runs of zero-length words, which the
 *   sanitizer drops (79 %). fp16 gave the same words at 1.6-1.7x the time.
 */
const MODEL_DTYPES: Readonly<Record<string, WeightsDtype>> = {
  "Xenova/whisper-small": { encoder_model: "fp32", decoder_model_merged: "q8" },
};

export function defaultDtype(model: string): WeightsDtype {
  return MODEL_DTYPES[model] ?? DEFAULT_DTYPE;
}

/** Matches the library's own "long audio" example (docs comment in automatic-speech-recognition.d.ts). */
const DEFAULT_CHUNK_LENGTH_S = 30;

/** Whisper's input window: 30 s at 16 kHz. Language detection looks at one window. */
const WHISPER_WINDOW_SAMPLES = 30 * SAMPLE_RATE;

/**
 * Tokens Whisper may generate per second of audio, plus a margin for short audio. Normal speech
 * is about 3 tokens/s (2.6-3.0 on the fixtures) and dense Spanish at 6 words/s about 8, plus the
 * timestamp tokens: 12/s cuts no speech short, while a loop ("de la" ×430 in 19 s, from a user's
 * report) stops at a few hundred tokens instead of running to Whisper's limit on every pass.
 * Moonshine, a Whisper-like model, caps at 6/s for the same reason.
 */
const TOKENS_PER_SECOND = 12;
const TOKEN_MARGIN = 24;
/** Whisper's decoder has 448 positions, 4 of them taken by the start tokens. */
const MAX_NEW_TOKENS = 440;
/**
 * No run of this many tokens may be generated twice in one pass: a loop is cut after a dozen
 * tokens ("de la" after 6 copies, a sentence on its second copy) instead of hundreds. Measured on
 * dev/fixtures/audio (2026-09-28): 3 changed a correctly repeated word in es-short ("filtrado" became
 * "filtralo") and 5 cost en-short two words; 8 and 12 change nothing. 12 tokens are 8 words or
 * more, which a person rarely repeats word for word within 30 s. A repetition penalty (1.1) was
 * rejected: it penalizes every repeated token, and cost es-2min a word.
 */
const NO_REPEAT_NGRAM_SIZE = 12;

/**
 * The parts of the pipeline that language detection needs. The library's public types do not
 * describe calling the model directly, so this names only what is used.
 */
interface WhisperParts {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: ((inputs: { input_features: unknown; decoder_input_ids: Tensor }) => Promise<{ logits: Tensor }>) & {
    generation_config: { decoder_start_token_id: number; lang_to_id?: Record<string, number> | null };
  };
}

/**
 * Runs Whisper locally via @huggingface/transformers (D1: local by default, no API key,
 * audio never leaves the machine). One instance loads its model once and reuses it across
 * `transcribe()` calls, since model load time dominates for anything shorter than a couple
 * of minutes.
 *
 * `TranscribeOptions.prompt` is ignored: transformers.js 4.3 declares Whisper's prompt_ids but
 * does not implement them (no WhisperProcessor.get_prompt_ids, and generate() ignores the
 * option). Callers that promise a prompt to the user say so themselves (the CLI prints a note).
 */
export class LocalTranscriptionEngine implements TranscriptionEngine {
  readonly name: string;
  private readonly options: LocalEngineOptions;
  private readonly modelId: string;
  private readonly chunkLengthS: number;
  private pipelinePromise?: Promise<AutomaticSpeechRecognitionPipeline>;
  private vadPromise?: Promise<SileroVad | undefined>;
  /** Set during a transcribe() call that reports progress; see countGeneratedChunks. */
  private onChunkDone?: () => void;

  constructor(options: LocalEngineOptions = {}) {
    this.options = options;
    this.modelId = options.model ?? DEFAULT_MODEL;
    this.chunkLengthS = options.chunkLengthS ?? DEFAULT_CHUNK_LENGTH_S;
    this.name = `local:${this.modelId}`;
  }

  private getPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
    this.pipelinePromise ??= this.loadPipeline();
    return this.pipelinePromise;
  }

  /**
   * Loaded after Whisper, so the global `env` settings (host, fetch, WASM paths) are in place.
   * Undefined when disabled, or when it cannot be loaded: then everything is transcribed.
   */
  private getVad(): Promise<SileroVad | undefined> {
    if (this.options.vad === false) return Promise.resolve(undefined);
    this.vadPromise ??= this.getPipeline().then(() =>
      SileroVad.load().catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[pointcast] voice activity detection is off (${reason}); transcribing all the audio.`);
        return undefined;
      }),
    );
    return this.vadPromise;
  }

  private async loadPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
    const { threads, wasmPaths, remoteHost, remotePathTemplate, fetch, onProgress } = this.options;
    const wasm = env.backends.onnx.wasm;
    // `wasm` is a readonly reference that exists once the onnx backend module loads; only its
    // fields can be assigned. numThreads is the WASM backend's (browser) thread knob; in Node
    // (onnxruntime-node) the session_options below are the ones that apply.
    if (wasm && threads && threads > 0) wasm.numThreads = threads;
    if (wasm && wasmPaths) wasm.wasmPaths = wasmPaths;
    if (remoteHost) env.remoteHost = remoteHost;
    if (remotePathTemplate) env.remotePathTemplate = remotePathTemplate;
    if (fetch) env.fetch = fetch;

    onProgress?.({ stage: "loading-model", model: this.modelId, loadedBytes: 0, totalBytes: 0 });
    const asr = await pipeline("automatic-speech-recognition", this.modelId, {
      dtype: this.options.dtype ?? defaultDtype(this.modelId),
      device: this.options.device,
      session_options:
        threads && threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: threads } : undefined,
      // "progress_total" sums bytes over all the model's files, which is what a single bar needs.
      progress_callback: onProgress
        ? (info: ProgressInfo) => {
            if (info.status !== "progress_total") return;
            onProgress({ stage: "loading-model", model: this.modelId, loadedBytes: info.loaded, totalBytes: info.total });
          }
        : undefined,
    });
    this.countGeneratedChunks(asr);
    onProgress?.({ stage: "model-ready", model: this.modelId });
    return asr;
  }

  /**
   * The 4.3 pipeline has no per-chunk callback, but its `_call_whisper` calls `model.generate()`
   * exactly once per 30 s chunk, so wrapping that method on this pipeline's model counts chunks.
   * (A `streamer` option does not: Whisper's timestamp mode seeks inside a chunk and calls the
   * base generate() several times per chunk, 14 times for 8 chunks on es-2min.) Language
   * detection calls the model directly, not generate(), so it is not counted.
   */
  private countGeneratedChunks(asr: AutomaticSpeechRecognitionPipeline): void {
    const model = (asr as unknown as { model: { generate: (...args: unknown[]) => Promise<unknown> } }).model;
    const generate = model.generate.bind(model);
    model.generate = async (...args) => {
      const output = await generate(...args);
      this.onChunkDone?.();
      return output;
    };
  }

  /**
   * Loads the model without transcribing anything, so a UI can download it ahead of time and a
   * benchmark (dev/scripts/bench/transcribe.ts) can time loading apart from transcribing.
   */
  async preload(): Promise<void> {
    await this.getPipeline();
    await this.getVad();
  }

  /** One call at a time per engine: calls queue on the same model anyway, and progress is per call. */
  async transcribe(samples: Float32Array, opts: TranscribeOptions): Promise<WordsFile> {
    const { onProgress, strideLengthS } = this.options;
    const asr = await this.getPipeline();
    const vad = await this.getVad();

    // Only the speech goes to Whisper (speech.ts): on silence it invents words.
    const speech: SampleRange[] | undefined = vad ? speechRegions(await vad.probabilities(samples), samples.length) : undefined;
    if (speech?.length === 0) {
      // Nothing was said: no words, and no language to detect either.
      onProgress?.({ stage: "done", ...(opts.language ? { language: opts.language } : {}), words: 0 });
      return { schemaVersion: 1, engine: this.name, ...(opts.language ? { language: opts.language } : {}), words: [] };
    }
    const regions = speech ? regionsToTranscribe(speech, samples.length) : [{ start: 0, end: samples.length }];
    const compacted = new CompactedSpeech(samples, regions);
    const audio = compacted.samples;

    let language = opts.language;
    if (language === undefined) {
      onProgress?.({ stage: "detecting-language" });
      // Never let the library fall back to English silently (see language.ts).
      language = requireConfidentLanguage(await this.detectLanguage(asr, audio));
    }

    const chunksTotal = countChunks(audio.length, this.chunkLengthS, strideLengthS);
    let chunksDone = 0;
    const lang = language;
    this.onChunkDone = onProgress
      ? () => onProgress({ stage: "transcribing", language: lang, chunksDone: ++chunksDone, chunksTotal })
      : undefined;
    onProgress?.({ stage: "transcribing", language, chunksDone: 0, chunksTotal });

    // A model call sees one chunk at most, so the token budget follows the chunk's length.
    const chunkS = this.chunkLengthS > 0 ? this.chunkLengthS : Number.POSITIVE_INFINITY;
    const windowS = Math.min(audio.length / SAMPLE_RATE, chunkS);
    const maxNewTokens = Math.min(MAX_NEW_TOKENS, Math.ceil(windowS * TOKENS_PER_SECOND) + TOKEN_MARGIN);

    let output: { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    try {
      output = (await asr(audio, {
        return_timestamps: "word",
        chunk_length_s: this.chunkLengthS,
        stride_length_s: strideLengthS,
        language,
        task: "transcribe",
        // Inside `generation_config`, not as a direct `max_new_tokens`: Whisper's generate() skips
        // its seek loop when `max_new_tokens` is a direct option (modeling_whisper.js, 4.3), and
        // that loop is what transcribes the rest of a window after Whisper stops early in it.
        generation_config: { max_new_tokens: maxNewTokens, no_repeat_ngram_size: NO_REPEAT_NGRAM_SIZE },
      } as Record<string, unknown>)) as typeof output;
    } finally {
      this.onChunkDone = undefined;
    }

    const words: Word[] = (output.chunks ?? []).map((chunk) => ({
      text: chunk.text,
      start: secondsToMs(chunk.timestamp[0]),
      // The final word of a chunk can have a null end timestamp (Whisper did not predict
      // one before generation stopped); fall back to its start rather than leaving it out.
      end: secondsToMs(chunk.timestamp[1] ?? chunk.timestamp[0]),
    }));
    // Chunked long-form output can repeat the overlap between chunks (monotonic.ts). Then back to
    // the recording's timeline, where what speech cannot produce is dropped (sanitize.ts).
    const onTimeline = dropReemittedWords(words).map((word) => ({ ...word, ...compacted.toRecording(word.start, word.end) }));
    const { words: kept, unreliable } = sanitizeWords(onTimeline, {
      durationMs: Math.round((samples.length * 1000) / SAMPLE_RATE),
      ...(speech ? { speech: rangesToMs(speech) } : {}),
    });
    onProgress?.({ stage: "done", language, words: kept.length });

    return {
      schemaVersion: 1,
      engine: this.name,
      language,
      words: kept,
      ...(unreliable.length > 0 ? { unreliable } : {}),
    };
  }

  /**
   * Scores Whisper's language tokens once: the encoder on the first 30 s of speech, then one
   * decoder step after the start-of-transcript token, whose prediction is the language.
   * Costs under a second with whisper-base, much less than the transcription itself.
   */
  private async detectLanguage(asr: AutomaticSpeechRecognitionPipeline, samples: Float32Array): Promise<LanguageGuess> {
    const { processor, model } = asr as unknown as WhisperParts;
    const { decoder_start_token_id: startToken, lang_to_id: languageTokens } = model.generation_config;
    if (!languageTokens) {
      throw new TranscriptionError("language-detection-unsupported", `${this.modelId} cannot detect the spoken language.`);
    }
    // With the VAD, `samples` starts at most 2 s before the speech (speech.ts); without it, the
    // recording's leading silence is skipped here.
    const from = speechStartSample(samples);
    const { input_features } = await processor(samples.subarray(from, from + WHISPER_WINDOW_SAMPLES));
    const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(startToken)]), [1, 1]);
    const { logits } = await model({ input_features, decoder_input_ids });
    // logits: [batch 1, positions 1, vocabulary]; the scores of the last position are at the end.
    const vocabulary = logits.dims.at(-1) ?? 0;
    const data = logits.data as Float32Array;
    const offset = data.length - vocabulary;
    const scores = new Map<string, number>();
    for (const [token, id] of Object.entries(languageTokens)) {
      scores.set(token, data[offset + id] ?? Number.NEGATIVE_INFINITY);
    }
    return pickLanguage(scores);
  }
}

function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
