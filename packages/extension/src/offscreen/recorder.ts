import type { CapturedEventDraft } from "@pointcast/core";
import {
  sendMessage,
  type CaptureEventResult,
  type OffscreenMessage,
  type ProcessingOptions,
  type RecorderStartResult,
  type RecorderStopResult,
  type RecorderUndoResult,
} from "../messages";
import { formatElapsed } from "../popup/view";
import { decodeRecording, samplesDurationMs } from "./audio";
import { EventLog } from "./event-log";
import { summarizeEvent } from "./event-summary";
import { MicrophoneDeniedError, MicrophoneRecording } from "./microphone-recording";
import type { LiveTranscription } from "./live-transcription";
import type { ProcessingJob } from "./session-processor";

interface ActiveSession {
  recording: MicrophoneRecording;
  log: EventLog;
  live: LiveTranscription | undefined;
}

/** Starts transcribing a recording while it is made (offscreen/live-transcription.ts). */
export type StartLive = (recording: MicrophoneRecording, language: string | undefined) => LiveTranscription;

/**
 * The recorder that lives in the offscreen document. Unlike the service worker, this document
 * stays alive for the whole session, so keeping the session in memory here is safe (D6).
 *
 * Stopping answers as soon as the audio is decoded; `startProcessing` then transcribes and
 * reports back on its own (offscreen/run-processing.ts), so no service worker event has to wait
 * for Whisper.
 */
export class Recorder {
  #active: ActiveSession | null = null;
  /**
   * The answer to the last stop. If the service worker is restarted while it waits for that
   * answer, the new instance asks again and gets the same answer instead of "Not recording",
   * and processing is not started twice.
   */
  #lastStop: Promise<RecorderStopResult> | null = null;

  constructor(
    private readonly startProcessing: (job: ProcessingJob) => void,
    /** Undefined: transcribe only after Stop. */
    private readonly startLive?: StartLive,
  ) {}

  handle(
    message: OffscreenMessage,
  ): Promise<RecorderStartResult | RecorderStopResult | CaptureEventResult | RecorderUndoResult> {
    switch (message.type) {
      case "recorder-start":
        return this.#start(message.language);
      case "recorder-stop":
        return this.#stop(message.extensionVersion, message.sessionId, message.options);
      case "capture-event":
        return Promise.resolve(this.#capture(message.draft));
      case "recorder-undo":
        return Promise.resolve(this.#undo());
    }
  }

  async #start(language: string | undefined): Promise<RecorderStartResult> {
    if (this.#active) return { ok: false, reason: "error", error: "Already recording" };
    try {
      const recording = await MicrophoneRecording.start();
      this.#active = { recording, log: new EventLog(recording.t0), live: this.#startLive(recording, language) };
      this.#lastStop = null;
      return { ok: true, t0: recording.t0 };
    } catch (error) {
      const reason = error instanceof MicrophoneDeniedError ? "microphone-denied" : "error";
      return { ok: false, reason, error: errorMessage(error) };
    }
  }

  #stop(extensionVersion: string, sessionId: string, options: ProcessingOptions): Promise<RecorderStopResult> {
    const active = this.#active;
    if (!active) return this.#lastStop ?? Promise.resolve({ ok: false, error: "Not recording" });
    // Detach first so drafts that arrive while the audio is being converted are rejected
    // instead of landing in a session.json that is already being written.
    this.#active = null;
    this.#lastStop = this.#finish(active, { extensionVersion, sessionId, options });
    return this.#lastStop;
  }

  async #finish(
    active: ActiveSession,
    { extensionVersion, sessionId, options }: { extensionVersion: string; sessionId: string; options: ProcessingOptions },
  ): Promise<RecorderStopResult> {
    const { recording, log, live } = active;
    const stoppedAt = Date.now();
    let compressed: Blob;
    try {
      compressed = await recording.stop();
    } catch (error) {
      live?.cancel();
      return { ok: false, error: `Could not save the recording: ${errorMessage(error)}` };
    }
    const warnings: string[] = [];
    const endedAt = recording.endedEarlyAt;
    if (endedAt !== undefined) {
      warnings.push(
        `The microphone stopped by itself ${formatElapsed(endedAt - recording.t0)} into the recording ` +
          "(disconnected or turned off?); there is no audio after that point.",
      );
    }

    // Capture faithfully: the events matter as much as the audio, so a recording the browser
    // cannot decode (e.g. a truncated WebM after a recorder error) must not throw them away.
    let audio: ProcessingJob["audio"];
    try {
      audio = { decoded: true, samples: await decodeRecording(compressed) };
    } catch (error) {
      // No decoded audio to measure: fall back to the wall clock.
      const durationMs = Math.max(0, (endedAt ?? stoppedAt) - recording.t0);
      audio = { decoded: false, raw: compressed, durationMs, error: errorMessage(error) };
    }

    const events = log.events;
    const durationMs = audio.decoded ? samplesDurationMs(audio.samples) : audio.durationMs;
    this.startProcessing({
      ...(live ? { live } : {}),
      sessionId,
      t0: recording.t0,
      events,
      extensionVersion,
      userAgent: navigator.userAgent,
      audio,
      warnings,
      options,
    });
    return {
      ok: true,
      sessionId,
      durationMs,
      pendingMs: live ? live.pendingMs(durationMs) : durationMs,
      modelLoaded: live?.modelLoaded ?? false,
      eventCount: events.length,
    };
  }

  /** Live transcription is only a speed-up: if it cannot start, Stop transcribes everything. */
  #startLive(recording: MicrophoneRecording, language: string | undefined): LiveTranscription | undefined {
    try {
      return this.startLive?.(recording, language);
    } catch (error) {
      console.warn("[pointcast] live transcription could not start", error);
      return undefined;
    }
  }

  #capture(draft: CapturedEventDraft): CaptureEventResult {
    if (!this.#active) return { accepted: false };
    const event = this.#active.log.add(draft);
    // Fire and forget: the count and the summary are only for the popup; losing one update is harmless.
    sendMessage({
      to: "background",
      type: "event-count",
      count: this.#active.log.events.length,
      lastEvent: summarizeEvent(event),
    }).catch(() => undefined);
    return { accepted: true, id: event.id };
  }

  /**
   * Undo: drops the last event of the current recording. The service worker writes the new count
   * and last-event line from this answer, so no "event-count" report is sent here: one writer for
   * one change.
   */
  #undo(): RecorderUndoResult {
    const log = this.#active?.log;
    const removed = log?.removeLast();
    if (!log || !removed) return { undone: null };
    const last = log.events.at(-1);
    return {
      undone: {
        id: removed.id,
        summary: summarizeEvent(removed),
        count: log.events.length,
        lastEvent: last ? summarizeEvent(last) : null,
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
