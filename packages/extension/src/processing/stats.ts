/**
 * What the extension learns from each processing run on this device, kept in
 * chrome.storage.local (it must survive browser restarts, unlike the recorder state):
 * - how fast this machine is, for the time estimate (progress.ts);
 * - whether the model was ever loaded here, to announce the first-time download;
 * - the last language, the fallback when language detection is unsure (D1 note 2026-09-27).
 * The first two are kept per speech model (speech-model.ts).
 */
import { modelKey, SPEECH_MODELS, type SpeechModel } from "./speech-model";

export interface SpeedStats {
  /** Model load from the Cache API plus ONNX session creation, in ms. */
  loadMs: number;
  /** Language detection and transcription time per second of audio, in ms. */
  msPerAudioSecond: number;
}

/** What was learned about one model (speech-model.ts) on this device. */
export interface ModelStats {
  speed: SpeedStats;
  /** True once this model has loaded successfully in this browser profile. */
  modelReady: boolean;
}

export interface ProcessingStats {
  /**
   * By modelKey(): each model is a download of its own and runs at its own speed (D1 note
   * 2026-09-29). Stats saved before the quality setting existed were whisper-base's.
   */
  models: Record<string, ModelStats>;
  /** Language of the previous transcript (ISO 639-1). */
  lastLanguage?: string;
}

export const DEFAULT_STATS: ProcessingStats = { models: {} };

/** A model that never ran here starts from its spike numbers (SpeechModel.defaultSpeed), not ready. */
export function statsFor(stats: ProcessingStats, model: SpeechModel): ModelStats {
  return stats.models[modelKey(model)] ?? { speed: { ...model.defaultSpeed }, modelReady: false };
}

/** chrome.storage.local key. */
export const STATS_KEY = "processingStats";

/** One run's measurements, as the transcription worker reports them. */
export interface RunTimings {
  audioMs: number;
  loadMs: number;
  transcribeMs: number;
}

/**
 * Weight of the newest run. Half keeps the estimate following a machine that got busier or
 * faster, without one odd run (a background build, a laptop on battery) taking it over.
 */
const NEWEST_WEIGHT = 0.5;

/**
 * Short recordings still cost a whole 30 s Whisper window, so their per-second time is high;
 * under this length they would teach a speed that overestimates every longer recording.
 */
const MIN_AUDIO_TO_LEARN_MS = 5_000;

export function learnFromRun(
  stats: ProcessingStats,
  model: SpeechModel,
  run: RunTimings,
  language: string | undefined,
): ProcessingStats {
  const blend = (old: number, measured: number) => Math.round(old * (1 - NEWEST_WEIGHT) + measured * NEWEST_WEIGHT);
  const current = statsFor(stats, model);
  const speed = { ...current.speed };
  // A first run downloads the model: its load time says nothing about later, cached loads.
  if (current.modelReady) speed.loadMs = blend(speed.loadMs, run.loadMs);
  if (run.audioMs >= MIN_AUDIO_TO_LEARN_MS) {
    const measured = (run.transcribeMs * 1000) / run.audioMs;
    speed.msPerAudioSecond = clamp(blend(speed.msPerAudioSecond, measured), 20, 5_000);
  }
  const lastLanguage = language ?? stats.lastLanguage;
  return {
    models: { ...stats.models, [modelKey(model)]: { speed, modelReady: true } },
    ...(lastLanguage ? { lastLanguage } : {}),
  };
}

/** Storage may hold anything (another version, a hand edit); fall back field by field. */
export function parseStats(value: unknown): ProcessingStats {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const models: Record<string, ModelStats> = {};
  if (typeof v.models === "object" && v.models !== null) {
    for (const [key, entry] of Object.entries(v.models as Record<string, unknown>)) {
      const parsed = parseModelStats(entry, key);
      if (parsed) models[key] = parsed;
    }
  }
  // Saved before the quality setting: the top-level fields were whisper-base fp32's.
  const fastKey = modelKey(SPEECH_MODELS.fast);
  if (!models[fastKey] && ("speed" in v || "modelReady" in v)) {
    const legacy = parseModelStats(v, fastKey);
    if (legacy) models[fastKey] = legacy;
  }
  return {
    models,
    ...(typeof v.lastLanguage === "string" && v.lastLanguage !== "" ? { lastLanguage: v.lastLanguage } : {}),
  };
}

function parseModelStats(value: unknown, key: string): ModelStats | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Partial<Record<keyof ModelStats, unknown>>;
  const speed = (typeof v.speed === "object" && v.speed !== null ? v.speed : {}) as Partial<Record<keyof SpeedStats, unknown>>;
  const positive = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fallback);
  const fallback = (Object.values(SPEECH_MODELS).find((m) => modelKey(m) === key) ?? SPEECH_MODELS.fast).defaultSpeed;
  return {
    speed: {
      loadMs: positive(speed.loadMs, fallback.loadMs),
      msPerAudioSecond: positive(speed.msPerAudioSecond, fallback.msPerAudioSecond),
    },
    modelReady: v.modelReady === true,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
