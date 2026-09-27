import type { RecorderState } from "../recorder-state";
import type { SpeedStats } from "./stats";

/**
 * What the user sees while a session is processed: an ESTIMATE of the time left, from the audio
 * length and the speed measured on this device in earlier runs (stats.ts). Transcription reports
 * no useful progress for short audio (Whisper works in 30 s chunks, usually one), so time is the
 * only honest measure. The bar never reaches 100 % before the work is done.
 *
 * Pure: the service worker stores a ProcessingInfo in the recorder state, and the popup and the
 * in-page pill turn it into text with these functions, re-rendering every second.
 */

export type ProcessingStage =
  /** The recorder stops the microphone and decodes the audio. */
  | "stopping"
  /** First run only: the model is downloaded (291 MB), shown in MB rather than as a time. */
  | "downloading-model"
  /** Model load (from the cache), language detection, transcription, fusion, rendering. */
  | "transcribing"
  /** The files are being written to the downloads folder. */
  | "saving";

export interface ProcessingInfo {
  /** Date.now() when Stop was pressed. */
  startedAt: number;
  /** Length of the recording; the wall-clock length until the recorder reports the decoded one. */
  audioMs: number;
  stage: ProcessingStage;
  /** Epoch ms when processing is expected to end. */
  estimatedEnd: number;
  /** Epoch ms after which processing is abandoned (background/commands.ts processingDeadline). */
  deadline: number;
  /** While downloading-model: bytes over all model files, 0 until the library knows the sizes. */
  loadedBytes?: number;
  totalBytes?: number;
  /** True until the model has loaded once in this browser profile. */
  firstRun: boolean;
}

/** Stop, decode, spawn the worker, fuse, render, copy and hand the files over. */
const FIXED_MS = 1_000;

/** Time left once the model is in memory: transcription and the fixed steps. */
export function transcriptionEstimateMs(audioMs: number, speed: SpeedStats): number {
  return FIXED_MS / 2 + (speed.msPerAudioSecond * audioMs) / 1000;
}

/**
 * The whole job, from Stop. `withoutLoad` leaves the model load out: on the first run the
 * download cannot be estimated (it depends on the network; the popup and the pill show that stage
 * in MB instead), and live transcription may have loaded the model during the recording.
 */
export function processingEstimateMs(audioMs: number, speed: SpeedStats, withoutLoad: boolean): number {
  return FIXED_MS + (withoutLoad ? 0 : speed.loadMs) + transcriptionEstimateMs(audioMs, speed);
}

/** Below 100 %, whatever the clock says: done means the files are saved, not the estimate. */
const MAX_FRACTION = 0.95;

export interface ProgressView {
  text: string;
  /** For a progress bar, in [0, MAX_FRACTION]. */
  fraction: number;
}

export function processingView(info: ProcessingInfo, now: number): ProgressView {
  switch (info.stage) {
    case "downloading-model": {
      const { loadedBytes = 0, totalBytes = 0 } = info;
      const amount = totalBytes > 0 ? ` ${megabytes(loadedBytes)} / ${megabytes(totalBytes)} MB` : "";
      return {
        text: `Downloading the speech model (first time only)…${amount}`,
        fraction: totalBytes > 0 ? Math.min(MAX_FRACTION, (MAX_FRACTION * loadedBytes) / totalBytes) : 0,
      };
    }
    case "saving":
      return { text: "Saving…", fraction: MAX_FRACTION };
    case "stopping":
    case "transcribing": {
      const elapsed = Math.max(0, now - info.startedAt);
      const left = info.estimatedEnd - now;
      if (left <= 0) return { text: "Processing… almost done", fraction: MAX_FRACTION };
      return {
        text: `Processing… ~${formatDuration(left)}`,
        fraction: Math.min(MAX_FRACTION, elapsed / (elapsed + left)),
      };
    }
  }
}

/** "0:25", "1:05", rounded up so the last second shows "~0:01", not "~0:00". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/** How long the in-page pill keeps the outcome after processing ended. */
export const DONE_VISIBLE_MS = 5_000;
export const ERROR_VISIBLE_MS = 10_000;

/** The in-page pill (content/indicator.ts): nothing, REC, processing, or the outcome for a moment. */
export type PillView =
  | { kind: "recording" }
  | { kind: "processing"; text: string; fraction: number }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string }
  /** A short message while recording, e.g. what Undo removed; drawn by followWithPill.notice. */
  | { kind: "notice"; text: string };

export function pillView(state: RecorderState, now: number): PillView | null {
  if (state.status === "recording") return { kind: "recording" };
  if ((state.status === "stopping" || state.status === "processing") && state.processing) {
    return { kind: "processing", ...processingView(state.processing, now) };
  }
  if (state.status !== "idle" || !state.lastResult) return null;
  const age = now - state.lastResult.finishedAt;
  if (state.error) {
    return age < ERROR_VISIBLE_MS ? { kind: "error", text: `✗ ${firstSentence(state.error)} Details in the pointcast popup.` } : null;
  }
  if (age >= DONE_VISIBLE_MS) return null;
  return {
    kind: "done",
    text: state.lastResult.copied ? "✓ Copied — paste it into your agent" : "✓ Saved — copy it from the pointcast popup",
  };
}

/** Errors can be long; the pill has room for one sentence. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? text.slice(0, end + 1) : text;
  return sentence.length > 100 ? `${sentence.slice(0, 99)}…` : sentence;
}
