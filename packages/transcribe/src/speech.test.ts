import { describe, expect, it } from "vitest";
import { CompactedSpeech, SPEECH_PAD_SAMPLES, VAD_FRAME, rangesToMs, regionsToTranscribe, speechRegions } from "./speech";

const RATE = 16000;
const FRAMES_PER_S = RATE / VAD_FRAME; // 31.25

/** Per-frame probabilities: `parts` are [probability, seconds]. */
function probabilities(parts: readonly [number, number][]): Float32Array {
  const values: number[] = [];
  for (const [p, seconds] of parts) for (let i = 0; i < Math.round(seconds * FRAMES_PER_S); i++) values.push(p);
  return Float32Array.from(values);
}

const seconds = (ranges: readonly { start: number; end: number }[]) =>
  ranges.map(({ start, end }) => [Number((start / RATE).toFixed(2)), Number((end / RATE).toFixed(2))]);

describe("speechRegions", () => {
  it("finds nothing in noise", () => {
    expect(speechRegions(probabilities([[0.1, 20]]), 20 * RATE)).toEqual([]);
  });

  it("finds each phrase", () => {
    const p = probabilities([[0.05, 2], [0.9, 3], [0.05, 10], [0.9, 2], [0.05, 1]]);
    const found = seconds(speechRegions(p, p.length * VAD_FRAME));
    const expected = [[2, 5], [15, 17]];
    expect(found).toHaveLength(2);
    // Within a 32 ms frame or two: the phrases' lengths are rounded to whole frames.
    found.flat().forEach((value, i) => expect(Math.abs(value - expected.flat()[i]!)).toBeLessThan(0.07));
  });

  it("does not end speech on a short dip, or below the start threshold but above the end one", () => {
    const p = probabilities([[0.9, 1], [0.05, 0.064], [0.9, 1], [0.4, 0.5], [0.9, 1], [0, 1]]);
    expect(speechRegions(p, p.length * VAD_FRAME)).toHaveLength(1);
  });

  it("ignores bursts shorter than 250 ms (a click, a key)", () => {
    const p = probabilities([[0, 1], [0.99, 0.15], [0, 1]]);
    expect(speechRegions(p, p.length * VAD_FRAME)).toEqual([]);
  });

  it("closes speech that runs to the end of the audio", () => {
    const p = probabilities([[0, 1], [0.9, 2]]);
    const total = p.length * VAD_FRAME - 100; // the last frame was padded
    expect(speechRegions(p, total)).toEqual([{ start: 31 * VAD_FRAME, end: total }]);
  });
});

describe("regionsToTranscribe", () => {
  it("keeps pauses under 2 s, cuts longer silences, and pads within the audio", () => {
    const pad = SPEECH_PAD_SAMPLES;
    const regions = [
      { start: 100, end: 2 * RATE },
      { start: 3.9 * RATE, end: 5 * RATE }, // a 1.9 s pause: kept
      { start: 10 * RATE, end: 12 * RATE }, // a 5 s silence: cut
    ];
    expect(regionsToTranscribe(regions, 12 * RATE + 10)).toEqual([
      { start: 0, end: 5 * RATE + pad },
      { start: 10 * RATE - pad, end: 12 * RATE + 10 },
    ]);
  });

  it("keeps up to 2 s before the first phrase: recordings start with a short silence", () => {
    const regions = [
      { start: 5 * RATE, end: 7 * RATE },
      { start: 20 * RATE, end: 21 * RATE },
    ];
    expect(regionsToTranscribe(regions, 30 * RATE).map((r) => r.start / RATE)).toEqual([3, 20 - SPEECH_PAD_SAMPLES / RATE]);
  });

  it("transcribes nothing when nothing was said", () => {
    expect(regionsToTranscribe([], 10 * RATE)).toEqual([]);
  });
});

describe("CompactedSpeech", () => {
  // Speech at 2-4 s and 10-11 s of a 15 s recording: compacted, 0-2 s and 2-3 s.
  const recording = Float32Array.from({ length: 15 * RATE }, (_, i) => i);
  const compacted = new CompactedSpeech(recording, [
    { start: 2 * RATE, end: 4 * RATE },
    { start: 10 * RATE, end: 11 * RATE },
  ]);

  it("holds only the speech, in order", () => {
    expect(compacted.samples.length).toBe(3 * RATE);
    expect(compacted.samples[0]).toBe(2 * RATE);
    expect(compacted.samples[2 * RATE]).toBe(10 * RATE);
  });

  it("maps word times back to the recording", () => {
    expect(compacted.toRecording(500, 900)).toEqual({ start: 2_500, end: 2_900 });
    expect(compacted.toRecording(2_000, 2_300)).toEqual({ start: 10_000, end: 10_300 });
  });

  it("keeps a word's end inside the piece it starts in", () => {
    // Whisper stretched the last word of the first phrase over the join.
    expect(compacted.toRecording(1_700, 2_600)).toEqual({ start: 3_700, end: 4_000 });
  });

  it("puts words after the compacted audio after the end of the recording", () => {
    const { start } = compacted.toRecording(3_500, 4_000);
    expect(start).toBeGreaterThan(15_000);
  });
});

describe("rangesToMs", () => {
  it("converts samples to ms", () => {
    expect(rangesToMs([{ start: 8_000, end: 32_000 }])).toEqual([{ start: 500, end: 2_000 }]);
  });
});
