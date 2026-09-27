import { pipeline, env, Tensor } from "@huggingface/transformers";
import type {
  AutomaticSpeechRecognitionPipeline,
  DataType,
  DeviceType,
  ProgressInfo,
} from "@huggingface/transformers";
import type { Word, WordsFile } from "@pointcast/core";
import { countChunks } from "./chunks";
import { TranscriptionError } from "./errors";
import { pickLanguage, requireConfidentLanguage, speechStartSample, type LanguageGuess } from "./language";
import { dropReemittedWords } from "./monotonic";
import type { TranscribeOptions, TranscriptionEngine, TranscriptionProgressListener } from "./types";

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
   * Weights precision. Default "fp32": the precision the CLI has always used, and in the spike
   * q8 was slower in Node and less accurate on the 2-minute fixture (91 % vs 93 % of words).
   */
  dtype?: DataType;
  /** Default: the library's choice, "cpu" in Node and "wasm" in a browser. */
  device?: DeviceType;
  /** ONNX thread count. Unset lets onnxruntime pick (every core in Node: set it to stay polite). */
  threads?: number;
  /**
   * URL prefix (ending in "/") of ONNX Runtime's .wasm/.mjs files. Unset, transformers.js loads
   * them from jsDelivr, which an extension's CSP does not allow, so the extension serves its own
   * copy. A plain string, not {wasm, mjs}: that form makes the library import a blob: URL, which
   * extension pages also refuse (spikes/in-browser-whisper).
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
}

/**
 * Xenova/whisper-base, not an onnx-community equivalent: word-level timestamps need
 * cross-attentions in the ONNX export (`_extract_token_timestamps` in the library), and at
 * least onnx-community/whisper-tiny's export omits them ("Model outputs must contain cross
 * attentions to extract timestamps" — confirmed by hand while wiring this up). The Xenova
 * org's whisper exports were built for transformers.js from the start and do include them.
 *
 * Why base (scripts/bench/results.json, 2026-09-26, 152 s Spanish fixture, 4 threads): 93 % of
 * words right, word starts within 165 ms median / 265 ms p90, transcribed in 24 s. That meets
 * plan step 3's "under 60 s" with room to spare. tiny is less accurate (87 %); small (96 %,
 * 66 s) and large-v3-turbo (96 %, 122 s) miss the budget and do not time words any better.
 */
export const DEFAULT_MODEL = "Xenova/whisper-base";
export const DEFAULT_DTYPE: DataType = "fp32";

/** Matches the library's own "long audio" example (docs comment in automatic-speech-recognition.d.ts). */
const DEFAULT_CHUNK_LENGTH_S = 30;

/** Whisper's input window: 30 s at 16 kHz. Language detection looks at one window. */
const WHISPER_WINDOW_SAMPLES = 30 * 16000;

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
      dtype: this.options.dtype ?? DEFAULT_DTYPE,
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
   * benchmark (scripts/bench/transcribe.ts) can time loading apart from transcribing.
   */
  async preload(): Promise<void> {
    await this.getPipeline();
  }

  /** One call at a time per engine: calls queue on the same model anyway, and progress is per call. */
  async transcribe(samples: Float32Array, opts: TranscribeOptions): Promise<WordsFile> {
    const { onProgress, strideLengthS } = this.options;
    const asr = await this.getPipeline();

    let language = opts.language;
    if (language === undefined) {
      onProgress?.({ stage: "detecting-language" });
      // Never let the library fall back to English silently (see language.ts).
      language = requireConfidentLanguage(await this.detectLanguage(asr, samples));
    }

    const chunksTotal = countChunks(samples.length, this.chunkLengthS, strideLengthS);
    let chunksDone = 0;
    const lang = language;
    this.onChunkDone = onProgress
      ? () => onProgress({ stage: "transcribing", language: lang, chunksDone: ++chunksDone, chunksTotal })
      : undefined;
    onProgress?.({ stage: "transcribing", language, chunksDone: 0, chunksTotal });

    let output: { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    try {
      output = (await asr(samples, {
        return_timestamps: "word",
        chunk_length_s: this.chunkLengthS,
        stride_length_s: strideLengthS,
        language,
        task: "transcribe",
      })) as typeof output;
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
    // Chunked long-form output can repeat the overlap between chunks (monotonic.ts).
    const kept = dropReemittedWords(words);
    onProgress?.({ stage: "done", language, words: kept.length });

    return { schemaVersion: 1, engine: this.name, language, words: kept };
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
