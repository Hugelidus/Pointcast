/**
 * What the extension learns from each processing run on this device, kept in
 * chrome.storage.local (it must survive browser restarts, unlike the recorder state):
 * - how fast this machine is, for the time estimate (progress.ts);
 * - whether the model was ever loaded here, to announce the first-time download;
 * - the last language, the fallback when language detection is unsure (D1 note 2026-09-27).
 */

export interface SpeedStats {
  /** Model load from the Cache API plus ONNX session creation, in ms. */
  loadMs: number;
  /** Language detection and transcription time per second of audio, in ms. */
  msPerAudioSecond: number;
}

export interface ProcessingStats {
  speed: SpeedStats;
  /** True once the model has loaded successfully in this browser profile. */
  modelReady: boolean;
  /** Language of the previous transcript (ISO 639-1). */
  lastLanguage?: string;
}

/**
 * Before the first run: spike numbers (dev/spikes/in-browser-whisper, i9-12900K, 4 threads):
 * 1.6 s to load the cached model, 43 s for 152 s of audio (about 280 ms per second). Rounded up,
 * since a laptop is slower and an estimate that finishes early reads better than a late one.
 */
export const DEFAULT_STATS: ProcessingStats = {
  speed: { loadMs: 2_000, msPerAudioSecond: 300 },
  modelReady: false,
};

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

export function learnFromRun(stats: ProcessingStats, run: RunTimings, language: string | undefined): ProcessingStats {
  const blend = (old: number, measured: number) => Math.round(old * (1 - NEWEST_WEIGHT) + measured * NEWEST_WEIGHT);
  const speed = { ...stats.speed };
  // A first run downloads the model: its load time says nothing about later, cached loads.
  if (stats.modelReady) speed.loadMs = blend(speed.loadMs, run.loadMs);
  if (run.audioMs >= MIN_AUDIO_TO_LEARN_MS) {
    const measured = (run.transcribeMs * 1000) / run.audioMs;
    speed.msPerAudioSecond = clamp(blend(speed.msPerAudioSecond, measured), 20, 5_000);
  }
  const lastLanguage = language ?? stats.lastLanguage;
  return { speed, modelReady: true, ...(lastLanguage ? { lastLanguage } : {}) };
}

/** Storage may hold anything (another version, a hand edit); fall back field by field. */
export function parseStats(value: unknown): ProcessingStats {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof ProcessingStats, unknown>>;
  const speed = (typeof v.speed === "object" && v.speed !== null ? v.speed : {}) as Partial<Record<keyof SpeedStats, unknown>>;
  const positive = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fallback);
  return {
    speed: {
      loadMs: positive(speed.loadMs, DEFAULT_STATS.speed.loadMs),
      msPerAudioSecond: positive(speed.msPerAudioSecond, DEFAULT_STATS.speed.msPerAudioSecond),
    },
    modelReady: v.modelReady === true,
    ...(typeof v.lastLanguage === "string" && v.lastLanguage !== "" ? { lastLanguage: v.lastLanguage } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
