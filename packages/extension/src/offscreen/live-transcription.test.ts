import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscribeDone, TranscribeJob } from "../transcriber/protocol";
import { LIVE_LIMIT_S, LiveTranscription, type LiveDeps } from "./live-transcription";

const RATE = 16000;
const OPTIONS = { deadline: Number.MAX_SAFE_INTEGER, onProgress: () => undefined };

/** Loud tone for speech, digital silence for pauses. */
function audio(parts: readonly [kind: "speech" | "pause", seconds: number][]): Float32Array {
  const samples = new Float32Array(parts.reduce((sum, [, s]) => sum + Math.round(s * RATE), 0));
  let at = 0;
  for (const [kind, seconds] of parts) {
    for (let i = 0; i < Math.round(seconds * RATE); i++, at++) samples[at] = kind === "speech" ? 0.3 * Math.sin(at / 3) : 0;
  }
  return samples;
}

/** Pauses at 17.0-17.6 s and 33.6-34.2 s; 39.2 s in all. */
const RECORDING = audio([["speech", 17], ["pause", 0.6], ["speech", 16], ["pause", 0.6], ["speech", 5]]);

/** A worker that "hears" one word at 0.1 s into every piece, in the language it detects ("es"). */
function fakeWorker(result: Partial<TranscribeDone> = {}) {
  const jobs: Omit<TranscribeJob, "type" | "threads" | "wasmPaths">[] = [];
  const worker: LiveDeps["worker"] & { jobs: typeof jobs } = {
    jobs,
    onProgress: undefined,
    preload: vi.fn(async () => 1_500),
    transcribe: vi.fn(async (job) => {
      jobs.push(job);
      const text = `piece${jobs.length}`;
      return {
        type: "done" as const,
        words: { schemaVersion: 1 as const, engine: "local:test", language: job.language ?? "es", words: [{ text, start: 100, end: 400 }] },
        loadMs: 0,
        transcribeMs: 800,
        ...result,
      };
    }),
    terminate: vi.fn(),
  };
  return worker;
}

/** Records RECORDING in real time (fake clock) for `seconds`. */
function record(worker: LiveDeps["worker"], language?: string) {
  const startedAt = Date.now();
  const recordedMs = () => Date.now() - startedAt;
  const audioSoFar = vi.fn(async () => RECORDING.subarray(0, Math.min(RECORDING.length, Math.floor((recordedMs() * RATE) / 1000))));
  return { live: new LiveTranscription({ worker, audioSoFar, recordedMs }, language), audioSoFar };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LiveTranscription", () => {
  it("transcribes each piece while recording, so only the last one is left after Stop", async () => {
    const worker = fakeWorker();
    const { live, audioSoFar } = record(worker);
    expect(worker.preload).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_000);
    // Nothing can be cut before 15 s (+1 s that may still change): not even decoded yet.
    expect(audioSoFar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(39_200 - 14_000);
    expect(worker.jobs.map((job) => job.samples.length / RATE)).toEqual([
      expect.closeTo(17.3, 1),
      expect.closeTo(33.9 - 17.3, 1),
    ]);
    // The language found in the first piece is used for the next ones.
    expect(worker.jobs.map((job) => job.language)).toEqual([undefined, "es"]);
    expect(live.pendingMs(39_200)).toBeLessThan(6_000);

    const done = await live.finish(RECORDING, OPTIONS);
    expect(worker.jobs).toHaveLength(3);
    expect(worker.jobs[2]!.samples.length / RATE).toBeCloseTo(39.2 - 33.9, 1);
    // Every word on the recording's time line, in order.
    const starts = done.words.words.map((w) => w.start);
    expect(done.words.words.map((w) => w.text)).toEqual(["piece1", "piece2", "piece3"]);
    expect(starts[0]).toBe(100);
    expect(starts[1]! / 1000).toBeCloseTo(17.4, 1);
    expect(starts[2]! / 1000).toBeCloseTo(34.0, 1);
    expect(done).toMatchObject({ loadMs: 1_500, transcribeMs: 800, words: { language: "es", engine: "local:test" } });
    expect(done.audioMs! / 1000).toBeCloseTo(5.3, 1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("transcribes a short recording as one piece, exactly like the one-shot path", async () => {
    const worker = fakeWorker({ fallback: { guess: { code: "fr", probability: 0.5 }, used: "en", reason: "last-used" } });
    const { live } = record(worker);
    await vi.advanceTimersByTimeAsync(10_000);
    const done = await live.finish(RECORDING.subarray(0, 10 * RATE), { ...OPTIONS, fallbackLanguage: "en" });
    expect(worker.jobs).toEqual([{ samples: expect.any(Float32Array), fallbackLanguage: "en" }]);
    expect(done.fallback).toMatchObject({ used: "en" });
  });

  it("gives up when the language of the first piece is uncertain: the whole recording decides", async () => {
    const worker = fakeWorker({ fallback: { guess: { code: "fr", probability: 0.5 }, used: "fr", reason: "best-guess" } });
    const { live } = record(worker);
    await vi.advanceTimersByTimeAsync(39_200);
    await expect(live.finish(RECORDING, OPTIONS)).rejects.toThrow("uncertain");
    // No further piece was sent after the failure.
    expect(worker.jobs).toHaveLength(1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("gives up when the worker fails or the language was changed during the recording", async () => {
    const failing = fakeWorker();
    failing.preload = vi.fn(async () => Promise.reject(new Error("no model")));
    const first = record(failing).live;
    await vi.advanceTimersByTimeAsync(39_200);
    await expect(first.finish(RECORDING, OPTIONS)).rejects.toThrow("no model");

    const changed = record(fakeWorker(), "es").live;
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(changed.finish(RECORDING.subarray(0, 20 * RATE), { ...OPTIONS, language: "en" })).rejects.toThrow("language was changed");
  });

  it("says whether the model finished loading during the recording", async () => {
    const { live } = record(fakeWorker());
    expect(live.modelLoaded).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(live.modelLoaded).toBe(true);
    live.cancel();
  });

  it("stops decoding after the first LIVE_LIMIT_S of audio: each check decodes everything so far", async () => {
    // Silence: a pause everywhere, so pieces are cut as soon as possible.
    const total = (LIVE_LIMIT_S + 120) * RATE;
    const long = new Float32Array(total);
    const worker = fakeWorker();
    const startedAt = Date.now();
    const recordedMs = () => Date.now() - startedAt;
    const audioSoFar = vi.fn(async () => long.subarray(0, Math.min(total, Math.floor((recordedMs() * RATE) / 1000))));
    const live = new LiveTranscription({ worker, audioSoFar, recordedMs }, undefined);

    await vi.advanceTimersByTimeAsync((LIVE_LIMIT_S + 60) * 1000);
    const decodes = audioSoFar.mock.calls.length;
    const pieces = worker.jobs.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(audioSoFar).toHaveBeenCalledTimes(decodes);
    expect(worker.jobs).toHaveLength(pieces);
    const covered = worker.jobs.reduce((sum, job) => sum + job.samples.length, 0) / RATE;
    expect(covered).toBeGreaterThanOrEqual(LIVE_LIMIT_S);
    expect(covered).toBeLessThan(LIVE_LIMIT_S + 30);

    // Stop transcribes the rest in one piece.
    const done = await live.finish(long, OPTIONS);
    expect(worker.jobs).toHaveLength(pieces + 1);
    expect(done.audioMs! / 1000).toBeCloseTo(LIVE_LIMIT_S + 120 - covered, 0);
  });
});
