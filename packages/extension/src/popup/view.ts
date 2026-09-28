import { SESSIONS_FOLDER, type InputMode } from "@pointcast/core";
import { readableEvent } from "../event-words";
import { LOCAL_HOSTS } from "../hosts";
import type { TabCapture } from "../messages";
import { errorDetailOf } from "../processing/failure";
import { processingView, SPEECH_MODEL_MB } from "../processing/progress";
import { isTyped, type RecorderState } from "../recorder-state";

/**
 * What the popup shows for a given state: pure, so it is unit-tested without a browser.
 *
 * Naming (UX decision B): the product is "Pointcast" in every sentence the user reads;
 * `pointcast` in lowercase only names the CLI, the npm packages, commands and file names.
 * naming.test.ts fails on a lowercase one in the popup's prose.
 */

/**
 * How a message reads: ok is the success headline ("✓ Copied…"), warning is amber (the session
 * was saved, but something needs the user's attention), error is red (it failed). A warning is
 * never drawn as an error: after a refused MCP handoff the Markdown was still copied and saved,
 * and a red block made users think it was lost.
 */
export type Tone = "ok" | "warning" | "error";

export interface Message {
  tone: Tone;
  text: string;
}

/**
 * The microphone permission of the extension origin (navigator.permissions.query), undefined
 * when the browser cannot tell: then Record is offered as before, and the service worker opens
 * the permission page if getUserMedia is refused.
 */
export type MicrophonePermission = PermissionState | undefined;

/** What the popup knows besides the recorder state. */
export interface PopupContext {
  microphone?: MicrophonePermission;
  /** The active tab is a remote site the user has not enabled: Record would capture nothing there. */
  offSite?: boolean;
  /** Settings.inputMode: what the next Record starts. Typed needs no microphone (D12). */
  inputMode?: InputMode;
}

/** The main button: Record, Stop, or "Allow microphone" until Chrome has the grant. */
export interface MainButton {
  text: string;
  /** CSS class: red is reserved for recording, violet (primary) for any other first step. */
  kind: "record" | "stop" | "primary" | "secondary";
  action: "start" | "stop" | "allow-microphone";
  visible: boolean;
  enabled: boolean;
}

export interface PopupView {
  statusText: string;
  button: MainButton;
  /** The failure, or the success headline of the last session; null when there is neither. */
  message: Message | null;
  /** The raw text behind an error (a library message, a URL), folded under "Details". */
  details: string | null;
  /** The Time and Events cards: only while recording, where they change. */
  showStats: boolean;
  /** How to point and the shortcuts: only where the user is about to record, or recording. */
  showHints: boolean;
  /** The tab line; hidden while processing, where it would invite recording again. */
  showTab: boolean;
}

const STATUS_TEXT: Record<RecorderState["status"], string> = {
  idle: "Idle",
  starting: "Starting…",
  recording: "Recording",
  stopping: "Stopping…",
  processing: "Processing…",
};

function isBusy(state: RecorderState): boolean {
  return state.status === "stopping" || state.status === "processing";
}

export function popupView(state: RecorderState, context: PopupContext = {}): PopupView {
  return {
    statusText: STATUS_TEXT[state.status],
    button: mainButton(state, context),
    message: stateMessage(state),
    details: errorDetailOf(state) ?? null,
    showStats: state.status === "recording" || state.status === "starting",
    showHints: state.status === "idle" || state.status === "starting" || state.status === "recording",
    showTab: !isBusy(state),
  };
}

function mainButton(state: RecorderState, { microphone, offSite, inputMode }: PopupContext): MainButton {
  switch (state.status) {
    case "recording":
      return { text: "Stop", kind: "stop", action: "stop", visible: true, enabled: true };
    case "starting":
      return { text: "Record", kind: "record", action: "start", visible: true, enabled: false };
    case "stopping":
    case "processing":
      // Hidden, not only disabled: a big red button while the last recording is still being
      // processed read as an invitation to record again.
      return { text: "Record", kind: "record", action: "start", visible: false, enabled: false };
    case "idle":
      // Without the grant, Record opened a tab and closed the popup, and the error then sat under
      // a green "will be captured": the first action of every new user failed (decision E).
      // Typed mode (D12) never opens the microphone, so it never waits for the grant.
      if (inputMode !== "typed" && (microphone === "prompt" || microphone === "denied")) {
        return { text: "Allow microphone", kind: "primary", action: "allow-microphone", visible: true, enabled: true };
      }
      if (offSite) {
        return { text: "Record (this tab won't be captured)", kind: "secondary", action: "start", visible: true, enabled: true };
      }
      return { text: "Record", kind: "record", action: "start", visible: true, enabled: true };
  }
}

function stateMessage(state: RecorderState): Message | null {
  if (state.error) return { tone: "error", text: state.error };
  if (state.status !== "idle" || !state.lastSessionId) return null;
  const last = state.lastResult?.sessionId === state.lastSessionId ? state.lastResult : undefined;
  if (last?.copied) return { tone: "ok", text: "Copied. Paste it into your agent." };
  return { tone: "ok", text: last?.handedOffTo !== undefined ? "Sent to your agent." : "Saved." };
}

/** The notice while something the first recording needs is missing: the microphone, or the model. */
export interface FirstRunNotice {
  title: string;
  text: string;
}

/**
 * `modelReady` is ProcessingStats.modelReady (undefined until read). Shown only while idle: it
 * explains the first run before it starts, so the download is not a surprise after Stop.
 */
export function firstRunNotice(
  state: RecorderState,
  microphone: MicrophonePermission,
  modelReady: boolean | undefined,
  inputMode: InputMode = "voice",
): FirstRunNotice | null {
  // An error already says what to do (a failed download, a denied microphone): a second box
  // above it about the same step only pushed the error down. Typed mode (D12) needs neither the
  // microphone nor the model.
  if (state.status !== "idle" || state.error || inputMode === "typed") return null;
  const needsMicrophone = microphone === "prompt" || microphone === "denied";
  const needsModel = modelReady === false;
  // SPEECH_MODEL_MB is megabytes() of what the download reports, so the notice and the progress
  // after Stop give the same size.
  const model = `downloads the speech model (${SPEECH_MODEL_MB} MB, once); transcription then runs on this computer.`;
  const microphoneText =
    microphone === "denied"
      ? "The microphone is blocked for Pointcast. Allow microphone opens a page that shows how to unblock it."
      : "Pointcast needs the microphone once. Chrome asks for it in a page of its own.";
  if (needsMicrophone && needsModel) {
    return {
      title: "Before your first recording",
      text: `${microphone === "denied" ? microphoneText : "Pointcast needs the microphone once."} The first Stop also ${model}`,
    };
  }
  if (needsMicrophone) return { title: "Microphone needed", text: microphoneText };
  if (needsModel) return { title: "Before your first recording", text: `The first Stop ${model}` };
  return null;
}

/** The progress panel while stopping and processing. */
export interface ProcessingPanel {
  /** "Processing… ~0:05": changes every second, so it is not a live region. */
  text: string;
  /** For the bar, in [0, 1); null while nothing measurable is known (the bar is then empty). */
  fraction: number | null;
  /** The stage without numbers, announced once to screen readers when it changes. */
  stage: string;
  detail: string;
}

export function processingPanel(state: RecorderState, now: number): ProcessingPanel | null {
  const info = state.processing;
  if (!isBusy(state) || !info) return null;
  // Before the first run's download reports, any time estimate is made up (it depends on the
  // network): the first estimate used to say ~0:06 for a 294 MB download.
  if (info.firstRun && info.stage === "stopping") {
    return {
      text: "Preparing…",
      fraction: null,
      stage: "Preparing…",
      detail: "The first time, the speech model is downloaded once and kept in the browser.",
    };
  }
  const view = processingView(info, now);
  switch (info.stage) {
    case "downloading-model":
      return {
        text: view.text,
        fraction: (info.totalBytes ?? 0) > 0 ? view.fraction : null,
        stage: "Downloading the speech model…",
        detail: "It is kept in the browser, so later recordings skip this step.",
      };
    case "saving":
      return { text: view.text, fraction: view.fraction, stage: "Saving…", detail: "" };
    case "stopping":
    case "transcribing":
      return {
        text: view.text,
        fraction: view.fraction,
        stage: "Processing…",
        // A typed session (D12) transcribes nothing: there is nothing to estimate.
        detail: isTyped(state) ? "" : "The time is estimated from earlier runs on this device.",
      };
  }
}

/**
 * "0:12 of audio · 2 events": the recording's size in one line, while it is processed and after,
 * where the Time and Events cards would only repeat numbers that no longer change. It uses the
 * same format as the Time card, so the same recording never reads 00:12 in one place and 0:13 in
 * another.
 */
export function metaLine(state: RecorderState, eventCount: number): string | null {
  const audioMs = isBusy(state) ? state.processing?.audioMs : state.status === "idle" ? state.lastResult?.audioMs : undefined;
  if (audioMs === undefined || audioMs <= 0) return null;
  const events = `${eventCount} ${eventCount === 1 ? "event" : "events"}`;
  // A typed session (D12) has no audio: its length is how long the notes took.
  const typed = isBusy(state) ? isTyped(state) : state.lastResult?.typed === true;
  return typed ? `${formatElapsed(audioMs)} of notes · ${events}` : `${formatElapsed(audioMs)} of audio · ${events}`;
}

/** The Voice / Typed choice above Record (D12). */
export interface ModeView {
  /** Shown where the user is about to record, or recording (then it says which mode is on). */
  visible: boolean;
  /** Only while idle: a recording keeps the mode it started with. */
  enabled: boolean;
  value: InputMode;
}

export function modeView(state: RecorderState, settingsMode: InputMode): ModeView {
  const recording = state.status === "recording" || state.status === "starting";
  return {
    visible: state.status === "idle" || recording,
    enabled: state.status === "idle",
    value: recording ? (state.inputMode ?? "voice") : settingsMode,
  };
}

/** How to point, in the mode the next (or current) recording uses. */
export function pointingHint(mode: InputMode): string {
  return mode === "typed"
    ? "Alt+click or select text, then type what should change."
    : "Alt+click or select text to point.";
}

/** Where the last session is, on one line: a label, then the folder in the code font. */
export interface WhereView {
  label: string;
  /** What fits on the line; `title` holds the whole path. */
  path: string;
  title: string;
}

/** After processing: where it went, what to know, and what the buttons can do. */
export interface ResultView {
  where: WhereView | null;
  /** The warning of a session that was saved anyway: `lead` is its first sentence, in bold. */
  warning: { lead: string; body: string } | null;
  /** How the code pointers resolved against the dev server; null when no element had a chain. */
  code: string | null;
  /** "Copy again": the Markdown is still in memory and the session did not fail. */
  copyAgain: boolean;
  /** chrome.downloads id to reveal with "Show in folder". */
  showInFolder?: number;
  /**
   * "Copy path", for a session a Pointcast MCP server stored (D11): Chrome downloaded nothing it
   * could reveal, and the agent, or the user, wants the folder as text anyway.
   */
  copyPath?: string;
}

export function resultView(state: RecorderState, hasMarkdown: boolean): ResultView | null {
  if (state.status !== "idle") return null;
  const result = state.lastResult;
  if (!result && !state.lastSessionId) return null;
  const sessionId = result?.sessionId ?? state.lastSessionId;
  // A failed session: the error says what was kept; claiming "Saved to" here could be wrong.
  const where = state.error || sessionId === undefined ? null : whereView(sessionId, result?.handedOffTo);
  return {
    where,
    warning: state.warning && !state.error ? splitLead(state.warning) : null,
    code: result?.code ?? null,
    copyAgain: hasMarkdown && !state.error && result !== undefined,
    ...(result?.downloadId !== undefined ? { showInFolder: result.downloadId } : {}),
    ...(result?.handedOffTo !== undefined && !state.error ? { copyPath: result.handedOffTo } : {}),
  };
}

function whereView(sessionId: string, handedOffTo: string | undefined): WhereView {
  if (handedOffTo !== undefined) {
    return { label: "Sent to your agent's Pointcast MCP server", path: shortPath(handedOffTo), title: handedOffTo };
  }
  return {
    label: `Saved to Downloads › ${SESSIONS_FOLDER}`,
    path: sessionId,
    title: `Downloads/${SESSIONS_FOLDER}/${sessionId}/`,
  };
}

/**
 * The end of a long folder path, which is the part that tells sessions apart:
 * "~\AppData\Local\Temp\x\mcp-sessions\2026-09-28_11-38-25" → "…\mcp-sessions\2026-09-28_11-38-25".
 * CSS ellipsis would cut the end instead, where the session id is.
 */
export function shortPath(path: string, keep = 2): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  if (parts.length <= keep + 1) return path;
  return `…${separator}${parts.slice(-keep).join(separator)}`;
}

/**
 * What happened, in bold, then the rest: warnings and errors are long. The messages are written
 * "what happened: what to do" ("Could not download the speech model: check your internet
 * connection…", "Not sent to the Pointcast MCP server: it refused…"), so a colon before the end
 * of the first sentence ends the lead there, as in the mockups; the lead then gets its period and
 * the rest its capital. Otherwise the lead is the first sentence. "0:05" has no space after its
 * colon, so a time never splits.
 */
export function splitLead(text: string): { lead: string; body: string } {
  const end = text.search(/[.!?](\s|$)/);
  const colon = text.search(/:\s/);
  if (colon > 0 && (end < 0 || colon < end)) {
    const rest = text.slice(colon + 1).trim();
    return { lead: `${text.slice(0, colon)}.`, body: rest.charAt(0).toUpperCase() + rest.slice(1) };
  }
  if (end < 0) return { lead: text, body: "" };
  return { lead: text.slice(0, end + 1), body: text.slice(end + 1).trim() };
}

/** The recorder's summary for people (event-words.ts): `a «View report» · Alt+click` → `link “View report”`. */
export const friendlyEvent = readableEvent;

/**
 * "Last: link “View report”" while recording, so the user can confirm a gesture landed without
 * opening the files; null (hidden) otherwise. `lastEvent` is the recorder's summary.
 */
export function lastEventText(state: RecorderState, lastEvent: string | undefined): string | null {
  return state.status === "recording" && lastEvent ? `Last: ${friendlyEvent(lastEvent)}` : null;
}

/** What the popup says after an Undo: the gesture as the "Last:" line named it. */
export function undoneText(summary: string): string {
  return `Undone: ${friendlyEvent(summary)}`;
}

/** A part of the shortcuts line: a key combination (drawn as <kbd>) or plain text. */
export type HintPart = { key: string } | { text: string };

/**
 * The shortcuts, in one line: "Alt+Shift+S record · Alt+Shift+U undo". Each binding is what
 * Chrome reports for the command (chrome.commands.getAll), since the user may have changed it:
 * "" when there is none, because the user removed it or another extension already had the
 * suggested keys; undefined when it is not known. An unknown Record/Stop binding hides the line;
 * an unbound Undo is left out (the button still works).
 */
export function shortcutHint(record: string | undefined, undo?: string): HintPart[] | null {
  if (record === undefined) return null;
  if (record === "") return [{ text: "No keyboard shortcut for Record/Stop: set one in chrome://extensions/shortcuts." }];
  const parts: HintPart[] = [{ key: record }, { text: " record" }];
  if (undo) parts.push({ text: " · " }, { key: undo }, { text: " undo" });
  return parts;
}

/**
 * The popup's Time: the recording so far, counted from t0 (the recorder start, the same origin as
 * the audio and the events), then its length until the next recording starts. Once stopped, that
 * is the audio's length, from the processing info and then from lastResult, because the idle
 * state keeps no t0: the wall-clock length until the recorder has decoded the audio, then the
 * decoded length, as in the popup's "of audio" line.
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

/**
 * m:ss, or h:mm:ss past one hour, the format of every other duration the user sees ("0:12 of
 * audio", "~0:05"). Negative input (clock skew) shows as zero.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** What the popup says about the active tab, so a recording that captures nothing never goes unnoticed. */
export interface TabCaptureView {
  text: string;
  /**
   * ok: the tab is captured. warning: it is not, but nothing is being recorded.
   * error: it is not, while a recording is starting or running. muted: not known yet, or a
   * captured tab under a result, where green would compete with the result's own headline.
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
    case "attached": {
      if (state.status === "recording") return { text: "Capturing this tab.", tone: "ok" };
      const afterResult = state.status === "idle" && (state.lastSessionId !== undefined || state.lastResult !== undefined || !!state.error);
      return { text: "This tab will be captured when you record.", tone: afterResult ? "muted" : "ok" };
    }
    case "not-local":
      if (offHost !== undefined) return { text: `Pointcast is off on ${offHost}.`, tone: missed };
      return {
        text: `This tab is not captured: Pointcast runs on local dev hosts (${LOCAL_HOSTS.join(", ")}) and on sites you enable, not on file:// pages.`,
        tone: missed,
      };
    case "unavailable":
      return {
        text: `This tab is not captured: Pointcast could not attach to it (${capture.error}). Reload the page.`,
        tone: missed,
      };
  }
}

/** A remote site in the active tab: its host, and whether the user enabled Pointcast on it. */
export interface SiteStatus {
  host: string;
  enabled: boolean;
}

export interface SiteView {
  button: string;
  /** Enabling is the step that makes Record useful here, so it is primary (after the microphone). */
  kind: "primary" | "secondary";
  /** What enabling means, or that it is on; always says personal data is redacted there (D8). */
  note: string;
}

const REDACTION_NOTE = "Personal data in the page, such as emails and phone numbers, is redacted.";

/**
 * The "Enable on example.com" section; null (hidden) for local dev hosts and non-web pages.
 * Enable is secondary while the main button is "Allow microphone": two violet buttons left the
 * user without a first step, and nothing can be recorded, on any site, before the grant.
 */
export function siteView(site: SiteStatus | undefined, microphone?: MicrophonePermission): SiteView | null {
  if (!site) return null;
  const needsMicrophone = microphone === "prompt" || microphone === "denied";
  return site.enabled
    ? { button: `Remove ${site.host}`, kind: "secondary", note: `Enabled on ${site.host}. ${REDACTION_NOTE}` }
    : {
        button: `Enable on ${site.host}`,
        kind: needsMicrophone ? "secondary" : "primary",
        note: `Chrome asks to let Pointcast read this site only. ${REDACTION_NOTE}`,
      };
}

/** Undo is offered while recording, and can be pressed once something was captured. */
export function undoView(state: RecorderState, eventCount: number): { visible: boolean; enabled: boolean } {
  const visible = state.status === "recording";
  return { visible, enabled: visible && eventCount > 0 };
}

/**
 * The stage changes worth announcing to a screen reader, in one line; the countdown is left out,
 * or it would be read every second. Empty when there is nothing to say (idle, no result).
 */
export function stageAnnouncement(state: RecorderState, now: number): string {
  if (state.status === "idle") return "";
  if (isBusy(state)) return processingPanel(state, now)?.stage ?? STATUS_TEXT[state.status];
  return STATUS_TEXT[state.status];
}
