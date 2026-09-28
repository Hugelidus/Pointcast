import { browser } from "wxt/browser";
import type { TranscriptionProgress } from "@pointcast/transcribe";
import { sendMessage, type CommandResult, type ProcessingOptions, type ProcessingResult, type UndoResult } from "../messages";
import { processingEstimateMs, transcriptionEstimateMs, type ProcessingInfo } from "../processing/progress";
import { chosenLanguage } from "../processing/settings";
import { learnFromRun } from "../processing/stats";
import { savedLocationText, toggleCommand, type LastResult, type RecorderState } from "../recorder-state";
import { formatSessionId, nextFreeSessionId } from "../session-id";
import {
  readSettings,
  readState,
  readStats,
  resetCapturedEvents,
  writeCapturedEvent,
  writeEventCount,
  writeLastMarkdown,
  writeState,
  writeStats,
  writeUndone,
} from "../state-store";
import { showBadge, showOutcomeBadge } from "./badge";
import { attachToOpenTabs } from "./content-scripts";
import { notify } from "./notify";
import { closeOffscreenDocument, ensureOffscreenDocument, hasOffscreenDocument } from "./offscreen-document";
import { checkDownloads, sessionIdsInHistory, startSessionDownloads, turnOffAskWhereAdvice } from "./session-downloads";

/**
 * The service worker's command handlers. Each one reads the state from storage, acts, and
 * writes the new state back: nothing survives in variables between events (D6). background.ts
 * runs them one at a time, so two handlers never interleave their read-modify-write cycles.
 */

/** getUserMedia and the recorder start take well under a second; this only catches a hang. */
export const START_TIMEOUT_MS = 20_000;
/**
 * Stopping decodes and resamples the whole recording, which takes seconds even for an hour of
 * audio. Chrome ends a service worker event that runs for 5 minutes, so give up before that.
 * Transcription is not part of it: the recorder answers once the audio is decoded.
 */
export const STOP_TIMEOUT_MS = 180_000;

/**
 * How long processing may take: 10 minutes (the first run downloads 291 MB) plus twice the
 * audio length. The spike transcribed a minute of audio in 17 s, so this only catches a hang.
 */
export function processingDeadline(stoppedAt: number, audioMs: number): number {
  return stoppedAt + 10 * 60_000 + 2 * audioMs;
}

/**
 * The alarm that ends a processing state nobody finishes (the offscreen document crashed or was
 * closed). The offscreen document enforces the deadline itself and saves what it has; the alarm
 * fires a minute later, only if that did not happen. An alarm, not a timer: timers die with
 * the service worker, alarms wake it up (D6). The handoff to a pointcast MCP server after the
 * deadline fits in that minute by construction (offscreen/handoff.ts), so the alarm never closes
 * the offscreen document during an upload.
 */
export const PROCESSING_ALARM = "pointcast-processing-timeout";
export const ALARM_GRACE_MS = 60_000;

async function setState(state: RecorderState): Promise<void> {
  await writeState(state);
  await showBadge(state);
}

interface Outcome {
  lastSessionId?: string;
  error?: string;
  warning?: string;
  lastResult?: LastResult;
}

/** Back to idle, keeping where the last session went so the popup can still show it. */
function idle(previous: RecorderState, outcome: Outcome = {}): RecorderState {
  const lastSessionId = outcome.lastSessionId ?? previous.lastSessionId;
  const lastResult = outcome.lastResult ?? previous.lastResult;
  return {
    status: "idle",
    ...(lastSessionId ? { lastSessionId } : {}),
    ...(lastResult ? { lastResult } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.warning ? { warning: outcome.warning } : {}),
  };
}

/**
 * How the processing of `state` ended, now. Set on success and on failure alike, so the pill can
 * show the outcome for a moment (processing/progress.ts pillView) whichever way it went.
 */
function endedNow(state: RecorderState): LastResult {
  const finishedAt = Date.now();
  return {
    sessionId: state.sessionId ?? "",
    copied: false,
    audioMs: state.processing?.audioMs ?? 0,
    ...state.pendingResult,
    finishedAt,
    processingMs: finishedAt - (state.processing?.startedAt ?? finishedAt),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rejects when the recorder does not answer in time, so the state can never stay busy forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The recorder did not ${what} in time.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function startRecording(): Promise<CommandResult> {
  const state = await readState();
  if (state.status !== "idle") return { ok: false, error: `Cannot start while ${state.status}.` };

  await setState({ ...idle(state), status: "starting" });
  await resetCapturedEvents();
  // Every local tab gets a live content script before the recording is reported as started:
  // a tab opened before the extension was (re)loaded would otherwise capture nothing (D6).
  // Runs alongside the recorder start, so it normally adds no delay (at most ATTACH_TIMEOUT_MS,
  // for a tab that cannot answer). It never rejects: a tab that cannot be attached does not
  // stop the recording, and the popup shows the active tab's status.
  const attaching = attachToOpenTabs();
  try {
    await ensureOffscreenDocument();
    // The language goes along so the recording can be transcribed while it is made
    // (D1 note 2026-09-27, live transcription).
    const language = chosenLanguage(await readSettings());
    const result = await withTimeout(
      sendMessage({ to: "offscreen", type: "recorder-start", ...(language ? { language } : {}) }),
      START_TIMEOUT_MS,
      "start",
    );
    if (!result) throw new Error("The recorder did not answer.");
    if (!result.ok) {
      await closeOffscreenDocument();
      await setState(idle(state, { error: result.error }));
      // The grant must come from a visible extension page; the offscreen document cannot prompt (D6).
      if (result.reason === "microphone-denied") {
        await browser.tabs.create({ url: browser.runtime.getURL("/permission.html") });
      }
      return { ok: false, error: result.error };
    }
    await attaching;
    await setState({ status: "recording", t0: result.t0 });
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    await closeOffscreenDocument().catch(() => undefined);
    await setState(idle(state, { error: message }));
    return { ok: false, error: message };
  }
}

/** A folder name no earlier session used, from the downloads history and the last saved id. */
async function chooseSessionId(state: RecorderState): Promise<string> {
  const base = formatSessionId(new Date(state.t0 ?? Date.now()));
  const taken = await sessionIdsInHistory(base).catch(() => new Set<string>());
  if (state.lastSessionId) taken.add(state.lastSessionId);
  return nextFreeSessionId(base, taken);
}

export async function stopRecording(): Promise<CommandResult> {
  const state = await readState();
  if (state.status !== "recording") return { ok: false, error: `Cannot stop while ${state.status}.` };

  const stoppedAt = Date.now();
  // The wall-clock length until the recorder reports the decoded one.
  const audioMs = Math.max(0, stoppedAt - (state.t0 ?? stoppedAt));
  const stats = await readStats();
  const firstRun = !stats.modelReady;
  const processing: ProcessingInfo = {
    startedAt: stoppedAt,
    audioMs,
    stage: "stopping",
    estimatedEnd: stoppedAt + processingEstimateMs(audioMs, stats.speed, firstRun),
    deadline: processingDeadline(stoppedAt, audioMs),
    firstRun,
  };
  // The id is stored before asking the recorder, so a restarted service worker can resume
  // this stop with the same folder name (recoverInterruptedTransition).
  const stopping: RecorderState = { ...state, status: "stopping", sessionId: await chooseSessionId(state), processing };
  await setState(stopping);
  await browser.alarms.create(PROCESSING_ALARM, { when: processing.deadline + ALARM_GRACE_MS });
  return askRecorderToStop(stopping);
}

/** The popup's settings and what earlier runs taught, for the offscreen document. */
async function processingOptions(deadline: number): Promise<ProcessingOptions> {
  const [settings, stats] = await Promise.all([readSettings(), readStats()]);
  const language = chosenLanguage(settings);
  return {
    ...(language ? { language } : {}),
    ...(stats.lastLanguage ? { fallbackLanguage: stats.lastLanguage } : {}),
    keepAudio: settings.keepAudio,
    deadline,
    handoff: settings.handoff,
  };
}

/**
 * Asks the recorder to stop; state must be "stopping" with a sessionId and processing info.
 * The recorder answers once the audio is decoded, then processes on its own and reports with
 * "processing-done" (finishProcessing).
 */
async function askRecorderToStop(state: RecorderState): Promise<CommandResult> {
  try {
    const sessionId = state.sessionId ?? formatSessionId(new Date(state.t0 ?? Date.now()));
    const deadline = state.processing?.deadline ?? processingDeadline(Date.now(), 0);
    const result = await withTimeout(
      sendMessage({
        to: "offscreen",
        type: "recorder-stop",
        extensionVersion: browser.runtime.getManifest().version,
        sessionId,
        options: await processingOptions(deadline),
      }),
      STOP_TIMEOUT_MS,
      "finish saving",
    );
    if (!result) throw new Error("The recorder did not answer.");
    if (!result.ok) throw new Error(result.error);
    await writeEventCount(result.eventCount);
    const current = await readState();
    // Already past "stopping" if the recorder reported the end of processing first.
    if (current.status === "stopping" && current.sessionId === result.sessionId && current.processing) {
      const stats = await readStats();
      const { startedAt, firstRun } = current.processing;
      // With live transcription the first run's download may be over by Stop; no report would
      // then ever move the popup past "Downloading the speech model".
      const downloading = firstRun && !result.modelLoaded;
      await setState({
        ...current,
        status: "processing",
        processing: {
          ...current.processing,
          audioMs: result.durationMs,
          stage: downloading ? "downloading-model" : "transcribing",
          // Only the audio live transcription has not done yet is left to wait for, and no model
          // load when it is loaded already (on a first run, the download is shown in MB instead).
          estimatedEnd:
            startedAt + processingEstimateMs(result.pendingMs, stats.speed, firstRun || result.modelLoaded),
        },
      });
    }
    return { ok: true };
  } catch (error) {
    // Also the path when the offscreen document is gone (e.g. it crashed): sendMessage then
    // rejects with "Receiving end does not exist", and the state goes back to idle.
    const message = errorMessage(error);
    await endProcessing();
    await setState(idle(state, { error: message, lastResult: endedNow(state) }));
    await announce(false, "pointcast: stopping failed", message);
    return { ok: false, error: message };
  }
}

/** Frees what processing held: the offscreen document (microphone, worker, blob URLs) and the alarm. */
async function endProcessing(): Promise<void> {
  await closeOffscreenDocument().catch(() => undefined);
  await browser.alarms.clear(PROCESSING_ALARM).catch(() => undefined);
}

function isProcessing(state: RecorderState, sessionId: string): boolean {
  return (state.status === "stopping" || state.status === "processing") && state.sessionId === sessionId;
}

/**
 * The worker's progress, for the pill and the popup. Only two reports change what they show:
 * the first-run model download (in MB), and model-ready, from which the time left is estimated
 * again from this device's transcription speed (processing/progress.ts).
 */
export async function recordProcessingProgress(sessionId: string, progress: TranscriptionProgress): Promise<void> {
  const state = await readState();
  const info = state.processing;
  if (!isProcessing(state, sessionId) || !info) return;
  let next: ProcessingInfo;
  if (progress.stage === "loading-model" && info.firstRun) {
    next = { ...info, stage: "downloading-model", loadedBytes: progress.loadedBytes, totalBytes: progress.totalBytes };
  } else if (progress.stage === "model-ready") {
    const { speed } = await readStats();
    next = { ...info, stage: "transcribing", estimatedEnd: Date.now() + transcriptionEstimateMs(info.audioMs, speed) };
  } else {
    return;
  }
  // No badge change: it stays "…" for the whole job.
  await writeState({ ...state, processing: next });
}

/**
 * The offscreen document finished processing (or gave up and saved what it had): start the
 * downloads, remember the Markdown for "Copy again" and what this run says about the device's
 * speed, and finish once the files are saved. When a pointcast MCP server already stored the
 * files, there is nothing to download and the session ends at once. Idempotent: the recorder
 * retries the report when it gets no answer, and a report for another session or a finished one
 * changes nothing.
 */
export async function finishProcessing(sessionId: string, result: ProcessingResult): Promise<{ ok: true }> {
  const state = await readState();
  if (!isProcessing(state, sessionId) || state.pendingDownloads || !state.processing) return { ok: true };

  // Before the no-files check: a handed-off result has no files by design.
  if (result.handedOff) return finishHandedOff(state, sessionId, result, result.handedOff.dir);

  if (result.files.length === 0) {
    await endProcessing();
    const error = result.error ?? "Processing produced no files.";
    await setState(idle(state, { error, lastResult: endedNow(state) }));
    await announce(false, "pointcast: processing failed", error);
    return { ok: true };
  }

  let pendingDownloads: number[];
  try {
    pendingDownloads = await startSessionDownloads(sessionId, result.files);
  } catch (error) {
    // Still answered { ok: true }: a retried report would start every download again (duplicate
    // "session (1).md" files) and then leave the state busy until the processing alarm.
    await endProcessing();
    const message = `Saving session ${sessionId} failed: ${errorMessage(error)}`;
    await setState(idle(state, { error: message, lastResult: endedNow(state) }));
    await announce(false, "pointcast: saving failed", message);
    return { ok: true };
  }
  await rememberRun(result);
  await setState({
    ...state,
    status: "processing",
    pendingDownloads,
    processing: { ...state.processing, stage: "saving" },
    pendingResult: {
      sessionId,
      copied: result.copied,
      ...(pendingDownloads[0] !== undefined ? { downloadId: pendingDownloads[0] } : {}),
      audioMs: result.audioMs,
      ...(result.code ? { code: result.code } : {}),
    },
    ...(result.error ? { error: result.error } : {}),
    ...(result.warning ? { warning: result.warning } : {}),
  });
  // Small files may complete before their ids were stored, i.e. before onChanged could
  // recognise them as ours, so check once right away.
  await finishSessionIfSaved();
  return { ok: true };
}

/** The Markdown for "Copy again", and what this run says about the device's speed. */
async function rememberRun(result: ProcessingResult): Promise<void> {
  if (result.markdown !== undefined) await writeLastMarkdown(result.markdown);
  if (result.timings) {
    const stats = await readStats();
    await writeStats(learnFromRun(stats, result.timings, result.language));
  }
}

/**
 * A pointcast MCP server stored the files (D11): Chrome downloads nothing, so the session is
 * saved already. `dir` is the folder the server reported, for display.
 */
async function finishHandedOff(
  state: RecorderState,
  sessionId: string,
  result: ProcessingResult,
  dir: string,
): Promise<{ ok: true }> {
  const lastResult = endedNow({
    ...state,
    pendingResult: {
      sessionId,
      copied: result.copied,
      audioMs: result.audioMs,
      ...(result.code ? { code: result.code } : {}),
      handedOffTo: dir,
    },
  });
  // The files are safe on disk already, so nothing may leave the recorder busy with no alarm, which
  // a restart would then report as a lost recording. The last run ("Copy again", the speed
  // estimate) is optional: a failure (a full disk) is only logged. It is kept before the idle state,
  // which the popup reacts to by reading the Markdown for its Copy again button.
  await rememberRun(result).catch((error: unknown) => console.error("[pointcast] could not keep the last run", error));
  await setState(idle(state, { lastSessionId: sessionId, lastResult, error: result.error, warning: result.warning }));
  // No blob URLs to keep alive for downloads: the offscreen document can close now.
  await endProcessing();
  await announceSaved(sessionId, lastResult, { error: result.error, warning: result.warning, locationKnown: true });
  return { ok: true };
}

/**
 * Ends the session once every download has finished. Called after the downloads start and on
 * every downloads.onChanged event; it is idempotent, so a race between the two is harmless.
 * The offscreen document must stay open until then: it owns the blob URLs being downloaded.
 */
export async function finishSessionIfSaved(): Promise<void> {
  const state = await readState();
  if (state.status !== "processing" || !state.pendingDownloads || !state.sessionId) return;
  const sessionId = state.sessionId;
  const check = await checkDownloads(sessionId, state.pendingDownloads);
  if (check.outcome === "in-progress") return;
  await endProcessing();
  if (check.outcome === "failed") {
    // A cancelled save dialog is the same root cause as the folder-location warning below (Chrome's
    // "Ask where to save each file" setting), so it gets the same advice instead of the generic line.
    const error =
      check.error === "USER_CANCELED"
        ? `Saving session ${sessionId} failed: a save dialog was cancelled. ${turnOffAskWhereAdvice()}`
        : `Saving session ${sessionId} failed; see chrome://downloads.`;
    await setState(idle(state, { error, lastResult: endedNow(state) }));
    await announce(false, "pointcast: saving failed", error);
    return;
  }
  const lastResult = endedNow(state);
  const warning = [state.warning, check.warning].filter((w): w is string => Boolean(w)).join(" ") || undefined;
  await setState(
    idle(state, {
      lastSessionId: sessionId,
      lastResult,
      ...(state.error ? { error: state.error } : {}),
      ...(warning ? { warning } : {}),
    }),
  );
  // Chrome may have saved these files outside the session folder (check.warning says so): never
  // announce a location that is not actually where they ended up.
  await announceSaved(sessionId, lastResult, { error: state.error, warning, locationKnown: !check.warning });
}

/**
 * A saved session, downloaded or handed off: done (and where, when `locationKnown`), or that
 * transcription failed although the session and its audio were saved.
 */
async function announceSaved(
  sessionId: string,
  lastResult: LastResult,
  outcome: { error?: string; warning?: string; locationKnown: boolean },
): Promise<void> {
  if (outcome.error) {
    await announce(false, "pointcast: could not transcribe", outcome.error);
    return;
  }
  const done = lastResult.copied ? "Copied — paste it into your agent." : "Saved. Open the pointcast popup to copy it.";
  const warningNote = outcome.warning ? "See the popup for a warning. " : "";
  const message = outcome.locationKnown
    ? `${done} ${warningNote}${savedLocationText(sessionId, lastResult.handedOffTo)}`
    : `${done} ${warningNote}`.trimEnd();
  await announce(true, "pointcast", message);
}

/** The end of processing, on the toolbar icon and as a notification when the user wants one. */
async function announce(ok: boolean, title: string, message: string): Promise<void> {
  await showOutcomeBadge(ok);
  try {
    if ((await readSettings()).notify) await notify(title, message);
  } catch (error) {
    // A missing notification must not undo a saved session.
    console.error("[pointcast] could not show the notification", error);
  }
}

/**
 * The processing alarm fired. Normally the offscreen document has long reported (and cleared the
 * alarm); if the state is still busy, the document died or hung, and nothing else would ever end
 * this state.
 */
export async function abandonOverdueProcessing(): Promise<void> {
  const state = await readState();
  if (state.status !== "stopping" && state.status !== "processing") return;
  if (state.pendingDownloads) {
    await finishSessionIfSaved();
    return;
  }
  await endProcessing();
  const error = "Processing stopped responding and was abandoned. The recording could not be saved.";
  await setState(idle(state, { error, lastResult: endedNow(state) }));
  await announce(false, "pointcast: processing failed", error);
}

/**
 * Runs once when the service worker starts, before it handles any message.
 *
 * "starting", "stopping" and "processing" are only left by the code that entered them, which
 * awaits the offscreen document. If Chrome stopped the service worker during that wait, the new
 * instance would find the state busy forever: the popup's button stays disabled and Record is
 * refused until the browser restarts. A new instance means the old one is gone, so a busy state
 * here is always interrupted: resume what can be resumed, and otherwise go back to idle.
 */
export async function recoverInterruptedTransition(): Promise<void> {
  const state = await readState();
  if (state.status === "starting") {
    // The recorder may hold the microphone without anyone knowing: close it.
    await closeOffscreenDocument().catch(() => undefined);
    await setState(idle(state, { error: "Recording did not start because the extension was restarted. Press Record again." }));
    return;
  }
  if (state.status !== "stopping" && state.status !== "processing") return;
  if (state.pendingDownloads) {
    await finishSessionIfSaved();
    return;
  }
  if (await hasOffscreenDocument()) {
    // "stopping": the recorder answers a repeated stop with the same answer, and does not start
    // processing twice. "processing": the offscreen document reports when it is done, which
    // wakes this worker; the alarm covers a document that never does.
    if (state.status === "stopping") await askRecorderToStop(state);
    return;
  }
  await browser.alarms.clear(PROCESSING_ALARM).catch(() => undefined);
  await setState(
    idle(state, { error: "The recording was lost: the extension was restarted while processing it.", lastResult: endedNow(state) }),
  );
}

/**
 * The keyboard shortcut: the same command the popup's Record/Stop button sends in this state
 * (toggleCommand), so a start still opens the permission page when the microphone is denied.
 */
export async function toggleRecording(): Promise<CommandResult> {
  return toggleCommand(await readState()) === "stop" ? stopRecording() : startRecording();
}

/** The offscreen document reports each accepted event; the popup shows the count and the last event. */
export async function recordEventCount(count: number, lastEvent: string): Promise<void> {
  // Written under their own keys, so this cannot race with the status changes above.
  if ((await readState()).status === "recording") await writeCapturedEvent(count, lastEvent);
}

/**
 * Undo (popup button and keyboard shortcut): the recorder drops the last captured gesture, the
 * popup's count and last-event line follow, and the stored Undo tells the page that captured it
 * to flash the element and every visible page to say what was undone (content.ts).
 */
export async function undoLastEvent(): Promise<UndoResult> {
  if ((await readState()).status !== "recording") return { ok: false, error: "Undo works while recording." };
  const answer = await sendMessage({ to: "offscreen", type: "recorder-undo" });
  const undone = answer?.undone;
  if (!undone) return { ok: false, error: "Nothing to undo." };
  await writeCapturedEvent(undone.count, undone.lastEvent);
  await writeUndone({ id: undone.id, summary: undone.summary, at: Date.now() });
  return { ok: true, undone: undone.summary };
}
