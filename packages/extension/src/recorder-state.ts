import { SESSIONS_FOLDER, type InputMode } from "@pointcast/core";
import type { ProcessingInfo } from "./processing/progress";

/**
 * Recorder state machine, shared by the service worker (the only writer), the popup and
 * the content scripts (readers). It lives in chrome.storage.session, never in variables,
 * because Chrome stops the service worker after ~30 s idle (D6).
 *
 *   idle ─start─▶ starting ─started─▶ recording ─stop─▶ stopping ─audio decoded─▶ processing ─files saved or handed off─▶ idle
 *     ▲              │ (microphone denied / error)          │ (error)                  │ (error, timeout)
 *     └──────────────┴──────────────────────────────────────┴──────────────────────────┘
 *
 * stopping: the recorder stops the microphone and decodes the audio (seconds at most).
 * processing: the offscreen document transcribes, fuses, renders and copies the Markdown (D1 note
 * 2026-09-27), then hands the files to a running pointcast MCP server (D11), or the service
 * worker downloads them.
 */

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping" | "processing";

/** What failed, so the popup and the pill can pick their words without parsing `error`. */
export type ErrorKind =
  /** Record found no microphone grant: the permission page was opened. */
  | "microphone-denied"
  /** Record failed for another reason (no microphone, the recorder did not answer…). */
  | "start"
  /** The session was saved, but its audio could not be transcribed. */
  | "transcription"
  /** Stopping or processing failed, or saving the files did. */
  | "processing";

/** How the last processing ended, for the popup's details and the in-page "copied" moment. */
export interface LastResult {
  sessionId: string;
  /** Date.now() when the files were saved. */
  finishedAt: number;
  /** True when the Markdown reached the clipboard. */
  copied: boolean;
  /** chrome.downloads id of a file in the session folder, for "Show in folder". */
  downloadId?: number;
  /**
   * The session folder, for display ("~" for the home folder), when a pointcast MCP server stored
   * the files (D11); downloadId is then absent: Chrome downloaded nothing it could show.
   */
  handedOffTo?: string;
  audioMs: number;
  /** From Stop to saved. */
  processingMs: number;
  /** ProcessingResult.code: how the code pointers resolved against the dev server, in one line. */
  code?: string;
  /** A typed session (D12): `audioMs` is how long the notes took, with no audio. */
  typed?: boolean;
}

export interface RecorderState {
  status: RecorderStatus;
  /** Date.now() at the MediaRecorder start event; set while recording and stopping. */
  t0?: number;
  /**
   * The mode the current recording started in (Settings.inputMode, D12), from Record until it is
   * saved: the pill says "Notes" and the page opens a note box for each gesture when "typed".
   * Absent means voice, as in states written before 0.4.0.
   */
  inputMode?: InputMode;
  /** Folder name of the session being saved; known once the recorder has stopped. */
  sessionId?: string;
  /** chrome.downloads ids of the files being saved; the session ends when all complete. */
  pendingDownloads?: number[];
  /** Last session saved successfully, so the popup can say where it went. */
  lastSessionId?: string;
  /** Human-readable reason of the last failure, shown in the popup. */
  error?: string;
  /** The raw text behind `error` (a library message, a URL), for the popup's folded "Details". */
  errorDetail?: string;
  /** What `error` is about; absent in states written before 0.2.2, so readers must not need it. */
  errorKind?: ErrorKind;
  /**
   * Date.now() when Record failed. A failed start has no lastResult, so this is what lets the
   * pill say so for ERROR_VISIBLE_MS (processing/progress.ts pillView).
   */
  startFailedAt?: number;
  /** Problem with a session that was still saved (e.g. audio kept only as the raw recording). */
  warning?: string;
  /** While stopping and processing: the stage and the time estimate the pill and popup show. */
  processing?: ProcessingInfo;
  /** While processing saves the files: what lastResult will say once they are saved. */
  pendingResult?: Omit<LastResult, "finishedAt" | "processingMs">;
  lastResult?: LastResult;
}

/** chrome.storage.session key holding the RecorderState. */
export const STATE_KEY = "recorder";

/**
 * chrome.storage.session key holding the number of events captured in the current session.
 * It is a separate key on purpose: the offscreen document reports counts while the popup
 * may be stopping the recording, and two read-modify-write cycles on one object would
 * overwrite each other's changes (e.g. a late count putting "recording" back after "stopping").
 */
export const EVENT_COUNT_KEY = "eventCount";

/**
 * chrome.storage.session key holding a one-line summary of the last captured event
 * ("button «Export» · Alt+click"), written together with the count; null after a new recording
 * started. Built by the recorder from the sanitized event (offscreen/event-summary.ts).
 */
export const LAST_EVENT_KEY = "lastEvent";

/**
 * chrome.storage.session key holding the last Undo: which event was removed, so the content
 * script that captured it can flash the element, and every visible page can say what was undone.
 * `at` makes each Undo a change even when the same id is undone twice (e3 undone, a new e3
 * captured, undone again), because storage.onChanged only fires for a different value.
 */
export const UNDONE_KEY = "undone";

export interface UndoneEvent {
  id: string;
  summary: string;
  at: number;
}

/**
 * chrome.storage.session key holding the enabled sites (match patterns), written by the service
 * worker after each sync (background/site-scripts.ts). A page on a site the user just removed
 * reads it and releases itself at once: Chrome keeps running a content script after its host
 * permission is gone, until the page reloads.
 */
export const SITES_KEY = "sites";

export const IDLE_STATE: RecorderState = { status: "idle" };

/** Storage may hold anything (or nothing, after a browser restart); fall back to idle. */
export function parseState(value: unknown): RecorderState {
  if (typeof value !== "object" || value === null) return IDLE_STATE;
  const status = (value as { status?: unknown }).status;
  const valid: readonly unknown[] = ["idle", "starting", "recording", "stopping", "processing"];
  return valid.includes(status) ? (value as RecorderState) : IDLE_STATE;
}

/**
 * Where the session's files went, in one line for the popup and the notification: the folder a
 * pointcast MCP server reported (handedOffTo), or the folder Chrome's downloads were asked for.
 */
export function savedLocationText(sessionId: string, handedOffTo?: string): string {
  return handedOffTo !== undefined
    ? `Saved by the Pointcast MCP server to ${handedOffTo}`
    : `Saved to Downloads/${SESSIONS_FOLDER}/${sessionId}/`;
}

export function isRecording(state: RecorderState): boolean {
  return state.status === "recording";
}

/** The current recording is typed (D12): notes instead of speech. */
export function isTyped(state: RecorderState): boolean {
  return state.inputMode === "typed";
}

/**
 * The command the Record/Stop button sends in this state, and so also the keyboard shortcut.
 * In a busy state the service worker refuses a start, so neither path can start a second recording.
 */
export function toggleCommand(state: RecorderState): "start" | "stop" {
  return state.status === "recording" ? "stop" : "start";
}

/** The stored summary, or undefined when there is none (cleared, never set, or malformed). */
export function parseLastEvent(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The stored Undo, or undefined when there is none or it is malformed. */
export function parseUndone(value: unknown): UndoneEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, summary, at } = value as Partial<UndoneEvent>;
  return typeof id === "string" && typeof summary === "string" && typeof at === "number" ? { id, summary, at } : undefined;
}
