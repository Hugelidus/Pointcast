import { isTyped, type RecorderState } from "../recorder-state";
import { firstSentence } from "./failure";
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
  /** First run only: the model is downloaded (SPEECH_MODEL_MB), shown in MB rather than as a time. */
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
      // On the first run, before the download reports, the time depends on a download of unknown
      // size: any estimate would be made up (it said "~0:06" before a 294 MB download).
      if (info.stage === "stopping" && info.firstRun) return { text: "Preparing…", fraction: 0 };
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

/** The one way sizes are written (MB = 10^6 bytes), so the popup and the pill never disagree. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/**
 * The first run's download, in megabytes() of the total the model files report (whisper-base,
 * quantized encoder and merged decoder), for the popup's first-run note before any download report.
 */
export const SPEECH_MODEL_MB = 294;

/** How long the in-page pill keeps the outcome after processing ended; failures and warnings stay longer. */
export const DONE_VISIBLE_MS = 5_000;
export const ERROR_VISIBLE_MS = 10_000;

/**
 * The in-page pill (content/indicator.ts): nothing, REC, processing, or the outcome for a moment.
 * `text` starts with the outcome's glyph ("✓", "✗"). The pill has room for one short line, so a
 * problem only says that there is one and where to read it: the popup has the details.
 */
export type PillView =
  /** `typed`: a typed recording (D12), shown as "Notes" instead of "REC". */
  | { kind: "recording"; typed?: boolean }
  | { kind: "processing"; text: string; fraction: number }
  | { kind: "done"; text: string }
  /** Saved (and copied), with something the user should read in the popup. */
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string }
  /** A short message while recording, e.g. what Undo removed; drawn by followWithPill.notice. */
  | { kind: "notice"; text: string };

const SEE_POPUP = "See the Pointcast popup.";

export function pillView(state: RecorderState, now: number): PillView | null {
  if (state.status === "recording") return isTyped(state) ? { kind: "recording", typed: true } : { kind: "recording" };
  if ((state.status === "stopping" || state.status === "processing") && state.processing) {
    return { kind: "processing", ...processingView(state.processing, now) };
  }
  if (state.status !== "idle") return null;
  // A failed Record has no lastResult. With the keyboard shortcut the popup is closed, so the
  // pill is where the user learns why nothing is recording.
  if (state.error && state.startFailedAt !== undefined) {
    if (now - state.startFailedAt >= ERROR_VISIBLE_MS) return null;
    return {
      kind: "error",
      text:
        state.errorKind === "microphone-denied"
          ? "✗ Pointcast needs the microphone: allow it in the tab that just opened."
          : `✗ Recording did not start. ${SEE_POPUP}`,
    };
  }
  if (!state.lastResult) return null;
  const age = now - state.lastResult.finishedAt;
  if (state.error) {
    if (age >= ERROR_VISIBLE_MS) return null;
    // A library message (with a URL) cut at 100 characters helped nobody; the popup explains.
    const text = state.errorKind === "transcription" ? "Could not transcribe." : firstSentence(state.error);
    return { kind: "error", text: `✗ ${text} ${SEE_POPUP}` };
  }
  const copied = state.lastResult.copied;
  if (state.warning) {
    return age < ERROR_VISIBLE_MS ? { kind: "warning", text: `✓ ${copied ? "Copied" : "Saved"}, with a warning. ${SEE_POPUP}` } : null;
  }
  if (age >= DONE_VISIBLE_MS) return null;
  if (!copied) return { kind: "done", text: "✓ Saved · copy it from the Pointcast popup" };
  // Where it went, so "paste it into your agent" is not the only hint: an MCP server handed it over.
  return { kind: "done", text: `✓ Copied · ${state.lastResult.handedOffTo !== undefined ? "sent to your agent" : "saved to Downloads"}` };
}
