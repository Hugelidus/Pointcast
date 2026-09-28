import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturedEventDraft } from "@pointcast/core";
import type { ProcessingOptions, RecorderStopResult, RecorderUndoResult } from "../messages";
import type { LiveTranscription } from "./live-transcription";
import type { ProcessingJob } from "./session-processor";

const T0 = 1_790_000_000_000;

const microphone = vi.hoisted(() => ({
  endedEarlyAt: undefined as number | undefined,
  stop: async () => new Blob(["webm bytes"], { type: "audio/webm" }),
}));
const audio = vi.hoisted(() => ({
  decodeRecording: vi.fn<(blob: Blob) => Promise<Float32Array>>(),
  samplesDurationMs: (samples: Float32Array) => Math.round(samples.length / 16),
}));

vi.mock("../messages", () => ({ sendMessage: vi.fn(async () => null) }));
vi.mock("./audio", () => audio);
vi.mock("./microphone-recording", () => ({
  MicrophoneDeniedError: class extends Error {},
  MicrophoneRecording: {
    start: async () => ({
      t0: T0,
      get endedEarlyAt() {
        return microphone.endedEarlyAt;
      },
      stop: () => microphone.stop(),
    }),
  },
}));

const { Recorder } = await import("./recorder");
const { sendMessage } = await import("../messages");

const draft: CapturedEventDraft = {
  gesture: "point",
  atStart: T0 + 1500,
  atEnd: T0 + 1500,
  url: "http://localhost:5511/",
  element: { tag: "button", text: "Export", selector: "#export", selectorUnique: true, path: "button", html: "<button>Export</button>" },
};

const OPTIONS: ProcessingOptions = { keepAudio: false, deadline: T0 + 600_000, handoff: true, quality: "fast", instructionStyle: "intent" };

function newRecorder() {
  const jobs: ProcessingJob[] = [];
  return { recorder: new Recorder((job) => jobs.push(job)), jobs };
}

async function recordOneEvent() {
  const { recorder, jobs } = newRecorder();
  await recorder.handle({ to: "offscreen", type: "recorder-start" });
  await recorder.handle({ to: "offscreen", type: "capture-event", draft });
  return { recorder, jobs };
}

const stop = (recorder: InstanceType<typeof Recorder>) =>
  recorder.handle({
    to: "offscreen",
    type: "recorder-stop",
    extensionVersion: "0.1.0",
    sessionId: "2026-09-26_18-30-05",
    options: OPTIONS,
  }) as Promise<RecorderStopResult>;

describe("Recorder capture", () => {
  it("reports the count and a summary of the event it accepted, for the popup", async () => {
    vi.mocked(sendMessage).mockClear();
    const { recorder } = await recordOneEvent();
    await recorder.handle({ to: "offscreen", type: "capture-event", draft: { ...draft, gesture: "click" } });

    expect(vi.mocked(sendMessage).mock.calls.map(([message]) => message)).toEqual([
      { to: "background", type: "event-count", count: 1, lastEvent: "button «Export» · Alt+click" },
      { to: "background", type: "event-count", count: 2, lastEvent: "button «Export» · click" },
    ]);
  });

  it("ignores a repeated Alt+click on the same element within two seconds", async () => {
    vi.mocked(sendMessage).mockClear();
    const { recorder } = await recordOneEvent();
    const result = await recorder.handle({
      to: "offscreen",
      type: "capture-event",
      draft: { ...draft, atStart: draft.atStart + 1_500, atEnd: draft.atEnd + 1_500 },
    });

    expect(result).toEqual({ accepted: false });
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  it("accepts a point on another element and a later point after the duplicate window", async () => {
    const { recorder } = await recordOneEvent();
    const other = await recorder.handle({
      to: "offscreen",
      type: "capture-event",
      draft: { ...draft, atStart: draft.atStart + 500, atEnd: draft.atEnd + 500, element: { ...draft.element, selector: "#save", path: "button#save" } },
    });
    const later = await recorder.handle({
      to: "offscreen",
      type: "capture-event",
      draft: { ...draft, atStart: draft.atStart + 2_001, atEnd: draft.atEnd + 2_001 },
    });

    expect(other).toMatchObject({ accepted: true });
    expect(later).toMatchObject({ accepted: true });
  });
});

describe("Recorder undo", () => {
  const undo = (recorder: InstanceType<typeof Recorder>) =>
    recorder.handle({ to: "offscreen", type: "recorder-undo" }) as Promise<RecorderUndoResult>;

  it("removes the last event and says what is last now; the session keeps the rest", async () => {
    audio.decodeRecording.mockResolvedValue(new Float32Array(16_000));
    const { recorder, jobs } = await recordOneEvent();
    await recorder.handle({ to: "offscreen", type: "capture-event", draft: { ...draft, gesture: "select", selection: { text: "Orders" } } });

    expect(await undo(recorder)).toEqual({
      undone: { id: "e2", summary: "button «Orders» · selection", count: 1, lastEvent: "button «Export» · Alt+click" },
    });
    expect(await undo(recorder)).toEqual({
      undone: { id: "e1", summary: "button «Export» · Alt+click", count: 0, lastEvent: null },
    });
    expect(await undo(recorder)).toEqual({ undone: null });

    await recorder.handle({ to: "offscreen", type: "capture-event", draft });
    await stop(recorder);
    expect(jobs[0]?.events.map((event) => event.id)).toEqual(["e1"]);
  });

  it("has nothing to undo when not recording", async () => {
    const { recorder } = newRecorder();
    expect(await undo(recorder)).toEqual({ undone: null });
  });

  it("allows the same point again after it was undone", async () => {
    const { recorder } = await recordOneEvent();
    expect(await undo(recorder)).toMatchObject({ undone: { id: "e1" } });

    const repeated = await recorder.handle({
      to: "offscreen",
      type: "capture-event",
      draft: { ...draft, atStart: draft.atStart + 500, atEnd: draft.atEnd + 500 },
    });
    expect(repeated).toMatchObject({ accepted: true, id: "e1" });
  });
});

describe("Recorder stop", () => {
  beforeEach(() => {
    microphone.endedEarlyAt = undefined;
    audio.decodeRecording.mockReset();
    audio.decodeRecording.mockResolvedValue(new Float32Array(64_000));
  });

  it("answers once the audio is decoded, and hands the session over for processing", async () => {
    const { recorder, jobs } = await recordOneEvent();
    expect(await stop(recorder)).toEqual({ ok: true, sessionId: "2026-09-26_18-30-05", durationMs: 4000, pendingMs: 4000, modelLoaded: false, eventCount: 1 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      sessionId: "2026-09-26_18-30-05",
      t0: T0,
      extensionVersion: "0.1.0",
      audio: { decoded: true },
      warnings: [],
      options: OPTIONS,
    });
    expect(jobs[0]?.events.map((event) => event.id)).toEqual(["e1"]);
  });

  it("keeps every event and the raw recording when the audio cannot be decoded", async () => {
    audio.decodeRecording.mockRejectedValue(new Error("Unable to decode audio data"));
    const { recorder, jobs } = await recordOneEvent();

    expect(await stop(recorder)).toMatchObject({ ok: true, eventCount: 1 });
    const job = jobs[0];
    expect(job?.audio).toMatchObject({ decoded: false, error: "Unable to decode audio data" });
    if (job?.audio.decoded === false && !job.audio.typed) expect(await job.audio.raw.text()).toBe("webm bytes");
    expect(job?.events).toHaveLength(1);
  });

  it("tells the user when the microphone stopped by itself", async () => {
    microphone.endedEarlyAt = T0 + 65_000;
    const { recorder, jobs } = await recordOneEvent();
    await stop(recorder);
    expect(jobs[0]?.warnings.join(" ")).toMatch(/stopped by itself 1:05 into the recording/);
  });

  it("answers a repeated stop (service worker restarted mid-stop) the same way, and processes once", async () => {
    const { recorder, jobs } = await recordOneEvent();
    const first = await stop(recorder);
    const second = await stop(recorder);
    expect(second).toEqual(first);
    expect(audio.decodeRecording).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
  });

  it("starts live transcription at Record in the chosen language, and hands it over at Stop", async () => {
    const live = { pendingMs: vi.fn(() => 1_000), modelLoaded: true, cancel: vi.fn() };
    const startLive = vi.fn(() => live as unknown as LiveTranscription);
    const jobs: ProcessingJob[] = [];
    const recorder = new Recorder((job) => jobs.push(job), startLive);
    await recorder.handle({ to: "offscreen", type: "recorder-start", language: "es", quality: "accurate" });
    expect(startLive).toHaveBeenCalledWith(expect.objectContaining({ t0: T0 }), "es", "accurate");

    // Only the audio live transcription has not done yet is left to wait for.
    // The model loaded during the recording: nothing left to download.
    expect(await stop(recorder)).toMatchObject({ ok: true, durationMs: 4000, pendingMs: 1_000, modelLoaded: true });
    expect(live.pendingMs).toHaveBeenCalledWith(4000);
    expect(jobs[0]?.live).toBe(live);
  });

  it("still records when live transcription cannot start, and frees it when the recording is lost", async () => {
    const jobs: ProcessingJob[] = [];
    const broken = new Recorder((job) => jobs.push(job), () => {
      throw new Error("no Worker");
    });
    expect(await broken.handle({ to: "offscreen", type: "recorder-start" })).toMatchObject({ ok: true });
    expect(await stop(broken)).toMatchObject({ ok: true, pendingMs: 4000 });
    expect(jobs[0]?.live).toBeUndefined();

    const live = { pendingMs: () => 0, cancel: vi.fn() };
    const recorder = new Recorder(() => undefined, () => live as unknown as LiveTranscription);
    await recorder.handle({ to: "offscreen", type: "recorder-start" });
    microphone.stop = async () => Promise.reject(new Error("recorder error"));
    expect(await stop(recorder)).toMatchObject({ ok: false });
    expect(live.cancel).toHaveBeenCalled();
    microphone.stop = async () => new Blob(["webm bytes"], { type: "audio/webm" });
  });

  it("refuses to stop when nothing was ever recorded", async () => {
    expect(await stop(newRecorder().recorder)).toEqual({ ok: false, error: "Not recording." });
  });
});

describe("Recorder in typed mode (D12)", () => {
  async function typedRecorder() {
    const { recorder, jobs } = newRecorder();
    const started = await recorder.handle({ to: "offscreen", type: "recorder-start", inputMode: "typed" });
    return { recorder, jobs, started };
  }

  it("rejects a repeated point so typed mode can skip opening its note box", async () => {
    vi.mocked(sendMessage).mockClear();
    const { recorder } = await typedRecorder();
    const accepted = await recorder.handle({ to: "offscreen", type: "capture-event", draft });
    const duplicate = await recorder.handle({
      to: "offscreen",
      type: "capture-event",
      draft: { ...draft, atStart: draft.atStart + 1_500, atEnd: draft.atEnd + 1_500 },
    });

    expect(accepted).toMatchObject({ accepted: true });
    expect(duplicate).toEqual({ accepted: false });
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  it("starts without the microphone and hands over a job with no audio at Stop", async () => {
    const start = vi.spyOn(await import("./microphone-recording").then((m) => m.MicrophoneRecording), "start");
    const { recorder, jobs, started } = await typedRecorder();
    expect(start).not.toHaveBeenCalled();
    expect(started).toMatchObject({ ok: true, t0: expect.any(Number) });
    await recorder.handle({ to: "offscreen", type: "capture-event", draft: { ...draft, atStart: Date.now(), atEnd: Date.now() } });
    expect(await recorder.handle({ to: "offscreen", type: "capture-note", id: "e1", note: "  Export only the filtered rows  " })).toEqual({ ok: true });

    const result = await stop(recorder);
    expect(result).toMatchObject({ ok: true, pendingMs: 0, modelLoaded: false, eventCount: 1 });
    expect(audio.decodeRecording).not.toHaveBeenCalledWith(expect.anything());
    expect(jobs[0]?.audio).toMatchObject({ decoded: false, typed: true });
    expect(jobs[0]?.live).toBeUndefined();
    expect(jobs[0]?.events[0]?.note).toBe("Export only the filtered rows");
    start.mockRestore();
  });

  it("removes a note left blank, and the gesture of a cancelled note box", async () => {
    vi.mocked(sendMessage).mockClear();
    const { recorder, jobs } = await typedRecorder();
    for (let i = 0; i < 2; i++) await recorder.handle({ to: "offscreen", type: "capture-event", draft });
    await recorder.handle({ to: "offscreen", type: "capture-note", id: "e1", note: "first" });
    await recorder.handle({ to: "offscreen", type: "capture-note", id: "e1", note: "   " });
    expect(await recorder.handle({ to: "offscreen", type: "capture-discard", id: "e2" })).toEqual({ ok: true });
    expect(await recorder.handle({ to: "offscreen", type: "capture-discard", id: "e2" })).toEqual({ ok: false });
    expect(await recorder.handle({ to: "offscreen", type: "capture-note", id: "e9", note: "x" })).toEqual({ ok: false });
    // The popup's count follows the discard.
    expect(vi.mocked(sendMessage).mock.calls.at(-1)?.[0]).toEqual({
      to: "background",
      type: "event-count",
      count: 1,
      lastEvent: "button «Export» · Alt+click",
    });
    await stop(recorder);
    expect(jobs[0]?.events).toHaveLength(1);
    expect(jobs[0]?.events[0]).not.toHaveProperty("note");
  });

  it("hands the page errors over with the job: each event's, and the session's (D13)", async () => {
    const { recorder, jobs } = await typedRecorder();
    const now = Date.now();
    const error = { kind: "console-error" as const, message: "Export failed", at: now };
    expect(await recorder.handle({ to: "offscreen", type: "capture-error", draft: error })).toEqual({ ok: true });
    await recorder.handle({ to: "offscreen", type: "capture-event", draft: { ...draft, atStart: now + 100, atEnd: now + 100 } });
    await stop(recorder);
    expect(jobs[0]?.events[0]?.errors).toEqual([{ kind: "console-error", message: "Export failed", t: expect.any(Number) }]);
    expect(jobs[0]?.errors).toHaveLength(1);
    // Without errors, the job has none: session.json stays as before.
    const plain = await typedRecorder();
    await stop(plain.recorder);
    expect(plain.jobs[0]).not.toHaveProperty("errors");
    expect(await plain.recorder.handle({ to: "offscreen", type: "capture-error", draft: error })).toEqual({ ok: false });
  });

  it("ignores notes when not recording", async () => {
    const { recorder } = newRecorder();
    expect(await recorder.handle({ to: "offscreen", type: "capture-note", id: "e1", note: "x" })).toEqual({ ok: false });
    expect(await recorder.handle({ to: "offscreen", type: "capture-discard", id: "e1" })).toEqual({ ok: false });
  });
});
