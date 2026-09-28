/**
 * Typed message protocol between the extension contexts.
 *
 *   popup ─ start / stop / undo / attach-tab ─▶ service worker ── recorder-start / -stop / -undo ──▶ offscreen
 *   keyboard shortcut (chrome.commands) ──────▶ service worker (same start / stop / undo as the popup)
 *   content script ─ get-state ───────────────▶ service worker ◀── event-count ───────────────────── offscreen
 *                                               service worker ◀── processing-progress / -done ──── offscreen
 *   content script ─ capture-event (draft) ───────────────────────────────────────────────────────▶ offscreen
 *   service worker ─ ping (one tab) ──────────▶ content script
 *   offscreen ── POST 127.0.0.1:20547 (hello, session) ──▶ pointcast MCP server (D11)
 *
 * Messages to the service worker and the offscreen document are sent with
 * chrome.runtime.sendMessage (sendMessage), which delivers them to ALL extension pages and the
 * service worker (never back to the sender, never to content scripts). The `to` field says which
 * context must answer; every other listener ignores the message and, crucially, does not reply,
 * because the first reply wins.
 *
 * Messages to a content script are sent with chrome.tabs.sendMessage (sendToTab), which
 * delivers them only to the content scripts of that tab. A tab with no live content script
 * (never injected, or an orphaned copy from before an extension reload) rejects with
 * "Receiving end does not exist": that is how the service worker detects one (D6).
 */
import { browser } from "wxt/browser";
import type { CapturedEventDraft } from "@pointcast/core";
import type { TranscriptionProgress } from "@pointcast/transcribe";
import type { E2eRecord } from "./e2e-record";
import type { RecorderState } from "./recorder-state";

/** Answer to a user command (popup buttons). */
export type CommandResult = { ok: true } | { ok: false; error: string };

/** Answer to Undo: `undone` is the removed gesture in one line ("button «Export» · Alt+click"). */
export type UndoResult = { ok: true; undone: string } | { ok: false; error: string };

export type BackgroundMessage =
  | { to: "background"; type: "start" }
  | { to: "background"; type: "stop" }
  | { to: "background"; type: "get-state" }
  /** Removes the last captured gesture of the current recording. */
  | { to: "background"; type: "undo" }
  /**
   * Sent by the offscreen document after it accepts an event. `lastEvent` is that event in one
   * short line for the popup ("button «Export» · Alt+click"), built from the sanitized event.
   */
  | { to: "background"; type: "event-count"; count: number; lastEvent: string }
  /**
   * Sent by the popup for the active tab: makes sure a live content script runs there when the
   * tab is on a local dev host (injecting one if needed), and says whether the tab is captured.
   */
  | { to: "background"; type: "attach-tab"; tabId: number }
  /** What the transcription worker is doing, throttled by the offscreen document. */
  | { to: "background"; type: "processing-progress"; sessionId: string; progress: TranscriptionProgress }
  /** Processing ended, well or not: the files to save and what to tell the user. */
  | { to: "background"; type: "processing-done"; sessionId: string; result: ProcessingResult }
  /** e2e builds only: a side effect that was recorded instead of performed (e2e-record.ts). */
  | { to: "background"; type: "e2e-record"; record: E2eRecord };

/** Chosen by the service worker from the popup's settings and what earlier runs taught it. */
export interface ProcessingOptions {
  /** Undefined: detect the language. */
  language?: string;
  /** The previous session's language, used when detection is unsure. */
  fallbackLanguage?: string;
  keepAudio: boolean;
  /** Epoch ms after which transcription is abandoned; the session is then saved with its audio. */
  deadline: number;
  /** Settings.handoff: try a running pointcast MCP server before chrome.downloads (D11). */
  handoff: boolean;
}

/**
 * Files are handed over as blob: URLs created by the offscreen document. Offscreen documents
 * only have chrome.runtime (no chrome.downloads), and runtime messages are JSON, so the bytes
 * cannot travel to the service worker cheaply. A blob URL is a short string that
 * chrome.downloads can fetch, because it belongs to the same extension origin. It stays valid
 * while the offscreen document is open, so the service worker closes the document only after
 * every download completes.
 */
export interface SessionFileUrl {
  url: string;
  /** Plain file name inside the session folder, e.g. "session.md". */
  fileName: string;
}

export interface ProcessingResult {
  /**
   * In download order; the first one is what "Show in folder" selects. Empty when a pointcast MCP
   * server stored the files (handedOff).
   */
  files: SessionFileUrl[];
  /**
   * A pointcast MCP server stored the files (D11): `files` is then empty and nothing is
   * downloaded. `dir` is its session folder, for display, with "~" for the home folder.
   */
  handedOff?: { dir: string };
  /** The rendered spec, when transcription worked. */
  markdown?: string;
  /** True when the Markdown is on the clipboard. */
  copied: boolean;
  /** Language of the transcript. */
  language?: string;
  /** Transcription failed; the session and its audio were still saved. */
  error?: string;
  /** The raw text behind `error`, for the popup's "Details" (processing/failure.ts). */
  errorDetail?: string;
  /** Worked, with something the user should know (audio problems, a language fallback, no copy). */
  warning?: string;
  /**
   * How resolving the code pointers against the dev server went, in one line for the popup's
   * details ("Code pointer: 2 locations found…"). Absent when no element had a chain. Never an
   * error: a failure only leaves the spec without `text at:` lines.
   */
  code?: string;
  audioMs: number;
  /**
   * Measured by the worker, for the next time estimate (processing/stats.ts). `audioMs` is the
   * audio transcribed in `transcribeMs`: only the last piece when live transcription did the rest.
   */
  timings?: { loadMs: number; transcribeMs: number; audioMs: number };
}

export type OffscreenMessage =
  /** `language`: the popup's choice at Record, for live transcription; undefined means detect it. */
  | { to: "offscreen"; type: "recorder-start"; language?: string }
  /**
   * extensionVersion travels with the message: offscreen documents cannot read the manifest.
   * sessionId is chosen by the service worker, which can check the downloads history for a
   * folder with the same name (two sessions started within the same second).
   */
  | { to: "offscreen"; type: "recorder-stop"; extensionVersion: string; sessionId: string; options: ProcessingOptions }
  | { to: "offscreen"; type: "capture-event"; draft: CapturedEventDraft }
  | { to: "offscreen"; type: "recorder-undo" };

/** Sent with chrome.tabs.sendMessage to the tab's top frame (sendToTab). */
export type ContentMessage =
  /** "Is a content script of this extension instance alive in this tab?" */
  { to: "content"; type: "ping" };

export type Message = BackgroundMessage | OffscreenMessage | ContentMessage;

export type RecorderStartResult =
  | { ok: true; t0: number }
  /** "microphone-denied" tells the service worker to open the permission page. */
  | { ok: false; reason: "microphone-denied" | "error"; error: string };

/**
 * The recorder stopped the microphone and decoded the audio; processing goes on in the offscreen
 * document and ends with a "processing-done" message. Answering now keeps each service worker
 * event short: transcribing an hour of audio takes longer than Chrome lets one event run.
 */
export type RecorderStopResult =
  /**
   * `pendingMs`: audio not transcribed yet (live transcription did the rest), for the estimate.
   * `modelLoaded`: live transcription already loaded the model, so nothing is downloaded after Stop.
   */
  | { ok: true; sessionId: string; durationMs: number; pendingMs: number; modelLoaded: boolean; eventCount: number }
  | { ok: false; error: string };

/**
 * The recorder removed its last event: its id and summary, and what the popup shows now (the
 * new count and the summary of the event that is now last, null when none is left).
 * `undone: null` when there is nothing to undo (not recording, or no event yet).
 */
export type RecorderUndoResult = {
  undone: { id: string; summary: string; count: number; lastEvent: string | null } | null;
};

/** `id` is the event id assigned by the recorder ("e1", ...). Rejected when not recording. */
export type CaptureEventResult = { accepted: true; id: string } | { accepted: false };

/** Whether pointcast can capture in a tab. */
export type TabCapture =
  /** A live content script runs in the tab: it follows the recording. */
  | { status: "attached" }
  /** Neither a local dev host nor a site the user enabled (a remote site, file://, chrome://...) (D8). */
  | { status: "not-local" }
  /** A local dev host, but no content script could be attached (e.g. an error page, a stuck tab). */
  | { status: "unavailable"; error: string };

interface ResponseByType {
  start: CommandResult;
  stop: CommandResult;
  "get-state": RecorderState;
  undo: UndoResult;
  "event-count": null;
  "attach-tab": TabCapture;
  "processing-progress": null;
  "processing-done": { ok: true };
  "e2e-record": null;
  "recorder-start": RecorderStartResult;
  "recorder-stop": RecorderStopResult;
  "capture-event": CaptureEventResult;
  "recorder-undo": RecorderUndoResult;
  ping: { alive: true };
}

export type ResponseOf<M extends Message> = ResponseByType[M["type"]];

type Target = Message["to"];
type MessageTo<T extends Target> = Extract<Message, { to: T }>;

/**
 * Resolves to `undefined` when the receiver failed while handling the message; rejects when
 * nobody is listening (e.g. "Receiving end does not exist" if the offscreen document is gone).
 */
export function sendMessage<M extends BackgroundMessage | OffscreenMessage>(message: M): Promise<ResponseOf<M> | undefined> {
  return browser.runtime.sendMessage(message) as Promise<ResponseOf<M> | undefined>;
}

/**
 * Sends to the content script in the top frame of `tabId`. Rejects when the tab has no live
 * content script ("Could not establish connection. Receiving end does not exist.").
 */
export function sendToTab<M extends ContentMessage>(tabId: number, message: M): Promise<ResponseOf<M> | undefined> {
  return browser.tabs.sendMessage(tabId, message, { frameId: 0 }) as Promise<ResponseOf<M> | undefined>;
}

function isMessageTo<T extends Target>(target: T, value: unknown): value is MessageTo<T> {
  return typeof value === "object" && value !== null && (value as { to?: unknown }).to === target;
}

/**
 * Registers the handler for all messages addressed to `target`; returns a function that
 * removes it. Uses sendResponse + `return true` (keep the channel open for an async answer)
 * because that is the form every Chrome version supports; returning a Promise is not.
 */
export function listenFor<T extends Target>(
  target: T,
  handle: (message: MessageTo<T>) => Promise<ResponseOf<MessageTo<T>>>,
): () => void {
  const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
    if (!isMessageTo(target, message)) return false;
    handle(message).then(sendResponse, (error: unknown) => {
      console.error(`[pointcast] ${target} failed to handle "${message.type}"`, error);
      sendResponse(undefined);
    });
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
