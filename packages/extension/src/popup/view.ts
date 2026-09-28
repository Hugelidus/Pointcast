import { LOCAL_HOSTS } from "../hosts";
import type { TabCapture } from "../messages";
import { formatDuration, processingView, type ProgressView } from "../processing/progress";
import { savedLocationText, type RecorderState } from "../recorder-state";

/** What the popup shows for a given state: pure, so it is unit-tested without a browser. */
export interface PopupView {
  statusText: string;
  buttonText: "Record" | "Stop";
  buttonEnabled: boolean;
  message: { text: string; isError: boolean } | null;
}

const STATUS_TEXT: Record<RecorderState["status"], string> = {
  idle: "Idle",
  starting: "Starting…",
  recording: "Recording",
  stopping: "Stopping…",
  processing: "Processing…",
};

export function popupView(state: RecorderState): PopupView {
  const busy = state.status === "starting" || state.status === "stopping" || state.status === "processing";
  let message: PopupView["message"] = null;
  if (state.error) message = { text: state.error, isError: true };
  else if (state.status === "idle" && state.lastSessionId) {
    const last = state.lastResult?.sessionId === state.lastSessionId ? state.lastResult : undefined;
    const saved = `${last?.copied ? "Copied — paste it into your agent. " : ""}${savedLocationText(state.lastSessionId, last?.handedOffTo)}`;
    message = state.warning ? { text: `${saved} ${state.warning}`, isError: true } : { text: saved, isError: false };
  }
  return {
    statusText: STATUS_TEXT[state.status],
    buttonText: state.status === "recording" ? "Stop" : "Record",
    buttonEnabled: !busy,
    message,
  };
}

/** The progress panel while stopping and processing: the estimate, and what it is based on. */
export function processingPanel(state: RecorderState, now: number): (ProgressView & { detail: string }) | null {
  const info = state.processing;
  if ((state.status !== "stopping" && state.status !== "processing") || !info) return null;
  const detail = info.firstRun
    ? `${formatDuration(info.audioMs)} of audio. The first time, the speech model is downloaded once (291 MB) and kept in the browser.`
    : `${formatDuration(info.audioMs)} of audio. The time is estimated from earlier runs on this device.`;
  return { ...processingView(info, now), detail };
}

/** After processing: what the result buttons can do, and how long it took. */
export interface ResultView {
  /** "Copy again": the Markdown is still in memory and the session did not fail. */
  copyAgain: boolean;
  /** chrome.downloads id to reveal with "Show in folder". */
  showInFolder?: number;
  /** "0:12 of audio processed in 0:06." */
  timing: string | null;
  /** How the code pointers resolved against the dev server; null when no element had a chain. */
  code: string | null;
}

export function resultView(state: RecorderState, hasMarkdown: boolean): ResultView | null {
  const result = state.lastResult;
  if (state.status !== "idle" || !result) return null;
  return {
    copyAgain: hasMarkdown && !state.error,
    ...(result.downloadId !== undefined ? { showInFolder: result.downloadId } : {}),
    timing: result.audioMs > 0 ? `${formatDuration(result.audioMs)} of audio processed in ${formatDuration(result.processingMs)}.` : null,
    code: result.code ?? null,
  };
}

/**
 * "Last: button «Export» · Alt+click" while recording, so the user can confirm a gesture landed
 * without opening the files; null (hidden) otherwise. `lastEvent` is the recorder's summary.
 */
export function lastEventText(state: RecorderState, lastEvent: string | undefined): string | null {
  return state.status === "recording" && lastEvent ? `Last: ${lastEvent}` : null;
}

/**
 * The line about the Record/Stop keyboard shortcut. `shortcut` is the binding Chrome reports for
 * the command (chrome.commands.getAll): "" when there is none, because the user removed it or
 * another extension already had the suggested keys; undefined when it is not known, which hides
 * the line.
 */
export function shortcutHint(shortcut: string | undefined): string | null {
  if (shortcut === undefined) return null;
  if (shortcut === "") return "No keyboard shortcut for Record/Stop: set one in chrome://extensions/shortcuts.";
  return `${shortcut} starts or stops recording without opening this popup.`;
}

/**
 * The popup's Time: the recording so far, counted from t0 (the recorder start, the same origin as
 * the audio and the events), then its length until the next recording starts. Once stopped, that
 * is the audio's length, from the processing info and then from lastResult, because the idle
 * state keeps no t0: the wall-clock length until the recorder has decoded the audio, then the
 * decoded length, as in the popup's "of audio" lines.
 */
export function recordingTimeMs(state: RecorderState, now: number): number {
  switch (state.status) {
    case "recording":
      return state.t0 !== undefined ? now - state.t0 : 0;
    case "stopping":
    case "processing":
      return state.processing?.audioMs ?? 0;
    case "idle":
      return state.lastResult?.audioMs ?? 0;
    case "starting":
      return 0;
  }
}

/** mm:ss, or h:mm:ss past one hour. Negative input (clock skew) shows as zero. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** What the popup says about the active tab, so a recording that captures nothing never goes unnoticed. */
export interface TabCaptureView {
  text: string;
  /**
   * ok: the tab is captured. warning: it is not, but nothing is being recorded.
   * error: it is not, while a recording is starting or running. muted: not known yet.
   */
  tone: "ok" | "warning" | "error" | "muted";
}

/**
 * `capture` is undefined until the service worker has checked the tab. `offHost` is the host of
 * a site the user could enable but has not ("example.com"), for a shorter, more useful line.
 */
export function tabCaptureView(capture: TabCapture | undefined, state: RecorderState, offHost?: string): TabCaptureView {
  if (!capture) return { text: "Checking this tab…", tone: "muted" };
  const missed: TabCaptureView["tone"] = state.status === "recording" || state.status === "starting" ? "error" : "warning";
  switch (capture.status) {
    case "attached":
      return state.status === "recording"
        ? { text: "Capturing this tab.", tone: "ok" }
        : { text: "This tab will be captured when you record.", tone: "ok" };
    case "not-local":
      if (offHost !== undefined) return { text: `This tab is not captured: pointcast is off on ${offHost}.`, tone: missed };
      return {
        text: `This tab is not captured: pointcast only runs on local dev hosts (${LOCAL_HOSTS.join(", ")}), not on file:// pages or remote sites.`,
        tone: missed,
      };
    case "unavailable":
      return {
        text: `This tab is not captured: pointcast could not attach to it (${capture.error}). Reload the page.`,
        tone: missed,
      };
  }
}

/** A remote site in the active tab: its host, and whether the user enabled pointcast on it. */
export interface SiteStatus {
  host: string;
  enabled: boolean;
}

export interface SiteView {
  button: string;
  /** What enabling means, or that it is on; always says personal data is redacted there (D8). */
  note: string;
}

const REDACTION_NOTE = "Personal data in the page (emails, phone numbers…) is redacted on sites that are not local.";

/** The "Enable pointcast on this site" section; null (hidden) for local dev hosts and non-web pages. */
export function siteView(site: SiteStatus | undefined): SiteView | null {
  if (!site) return null;
  return site.enabled
    ? { button: `Remove ${site.host}`, note: `Enabled on ${site.host}. ${REDACTION_NOTE}` }
    : {
        button: `Enable on ${site.host}`,
        note: `Chrome will ask to let pointcast read ${site.host} only. ${REDACTION_NOTE}`,
      };
}

/** Undo is offered while recording, and can be pressed once something was captured. */
export function undoView(state: RecorderState, eventCount: number): { visible: boolean; enabled: boolean } {
  const visible = state.status === "recording";
  return { visible, enabled: visible && eventCount > 0 };
}

/** The Undo shortcut as Chrome has it; nothing when unbound (the button still works). */
export function undoShortcutHint(shortcut: string | undefined): string | null {
  return shortcut ? `${shortcut} undoes the last gesture.` : null;
}
