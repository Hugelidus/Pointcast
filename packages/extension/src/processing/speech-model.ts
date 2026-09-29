/**
 * The popup's "Transcription quality" setting and the Whisper model behind each choice (D1 note
 * 2026-09-29). Both come from the Xenova org on the same model host, because their ONNX exports
 * carry the cross-attentions that word timestamps need (packages/transcribe/src/local.ts).
 */
import type { WeightsDtype } from "@pointcast/transcribe";
import type { SpeedStats } from "./stats";

export type TranscriptionQuality = "fast" | "accurate";

export const TRANSCRIPTION_QUALITIES: readonly TranscriptionQuality[] = ["fast", "accurate"];

export interface SpeechModel {
  /** Hugging Face repo id; it ends up in words.json `engine` as "local:<id>". */
  id: string;
  /**
   * Weights precision passed to transformers.js: @pointcast/transcribe's defaultDtype(id), repeated
   * because importing that package's code would bundle transformers.js into the popup and the
   * service worker (speech-model.test.ts checks they agree).
   */
  dtype: WeightsDtype;
  /**
   * What the first use downloads, in megabytes() of what the model files report, for the popup's
   * notice before any download report.
   */
  downloadMB: number;
  /** The time estimate before this model has run on this device (processing/stats.ts). */
  defaultSpeed: SpeedStats;
}

export const SPEECH_MODELS: Readonly<Record<TranscriptionQuality, SpeechModel>> = {
  /**
   * whisper-base fp32 (D1 note 2026-09-27): 43 s for the 152 s fixture on 4 WASM threads, 1.6 s
   * to load from the Cache API. Rounded up, since a laptop is slower.
   */
  fast: {
    id: "Xenova/whisper-base",
    dtype: "fp32",
    downloadMB: 294,
    defaultSpeed: { loadMs: 2_000, msPerAudioSecond: 300 },
  },
  /**
   * whisper-small, fp32 encoder and q8 decoder (D1 note 2026-09-29): 95-96 % of the fixture's
   * words instead of 93 %, and fewer misheard words on real speech, for about 2.2× base's time:
   * 98 s for the 152 s fixture on 4 WASM threads, 5.5 s to load from the Cache API. Rounded up.
   */
  accurate: {
    id: "Xenova/whisper-small",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    downloadMB: 512,
    defaultSpeed: { loadMs: 6_000, msPerAudioSecond: 700 },
  },
};

/**
 * One entry per model and precision in the learned stats: another dtype is another download.
 * "Xenova/whisper-base:fp32", "Xenova/whisper-small:encoder_model=fp32,decoder_model_merged=q8".
 */
export function modelKey(model: SpeechModel): string {
  const { dtype } = model;
  const precision =
    typeof dtype === "string"
      ? dtype
      : Object.entries(dtype)
          .map(([file, type]) => `${file}=${type}`)
          .join(",");
  return `${model.id}:${precision}`;
}

/**
 * The model for a quality, and the fast one for anything else: a message from an older build, whose
 * service worker still runs after an unpacked extension was rebuilt under it, carries no quality,
 * and that must not cost the user their recording.
 */
export function speechModel(quality: TranscriptionQuality | undefined): SpeechModel {
  return quality === "accurate" ? SPEECH_MODELS.accurate : SPEECH_MODELS.fast;
}
