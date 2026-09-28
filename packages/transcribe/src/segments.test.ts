import { describe, expect, it } from "vitest";
import { findCut, joinSegments, joinUnreliable } from "./segments";

const RATE = 16000;

/** "Speech" is a loud tone, a pause is near-silence with a little noise, as from a real microphone. */
function audio(parts: readonly [kind: "speech" | "pause", seconds: number][]): Float32Array {
  const total = parts.reduce((sum, [, s]) => sum + Math.round(s * RATE), 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const [kind, seconds] of parts) {
    const n = Math.round(seconds * RATE);
    for (let i = 0; i < n; i++, at++) {
      samples[at] = kind === "speech" ? 0.3 * Math.sin((2 * Math.PI * 220 * at) / RATE) : 0.002 * Math.sin(at * 12.9898);
    }
  }
  return samples;
}

describe("findCut", () => {
  it("waits until there is at least 15 s of audio (plus 1 s that may still change)", () => {
    expect(findCut(audio([["speech", 8], ["pause", 1], ["speech", 6]]), 0)).toBeUndefined();
  });

  it("cuts in the middle of a pause after 15 s, never inside the speech", () => {
    // Pause from 17.0 to 17.6 s.
    const samples = audio([["speech", 17], ["pause", 0.6], ["speech", 5]]);
    const cut = findCut(samples, 0);
    expect(cut).toBeGreaterThanOrEqual(17.15 * RATE);
    expect(cut).toBeLessThanOrEqual(17.45 * RATE);
  });

  it("ignores pauses before 15 s", () => {
    const samples = audio([["speech", 5], ["pause", 1], ["speech", 11], ["pause", 0.5], ["speech", 3]]);
    const cut = findCut(samples, 0)!;
    expect(cut / RATE).toBeGreaterThan(17);
    expect(cut / RATE).toBeLessThan(17.5);
  });

  it("counts from the previous cut", () => {
    const samples = audio([["speech", 20], ["speech", 16], ["pause", 0.5], ["speech", 3]]);
    const cut = findCut(samples, 20 * RATE)!;
    expect(cut / RATE).toBeGreaterThan(36);
    expect(cut / RATE).toBeLessThan(36.5);
  });

  it("waits for a pause while under 30 s, then cuts at the quietest point by 30 s at the latest", () => {
    expect(findCut(audio([["speech", 25]]), 0)).toBeUndefined();
    const nonstop = audio([["speech", 40]]);
    const cut = findCut(nonstop, 0)!;
    expect(cut).toBeGreaterThanOrEqual(15 * RATE);
    expect(cut).toBeLessThanOrEqual(30 * RATE);
  });

  it("cuts a recording of silence (nothing to lose there)", () => {
    const cut = findCut(new Float32Array(20 * RATE), 0);
    expect(cut).toBeGreaterThanOrEqual(15 * RATE);
  });
});

describe("joinSegments", () => {
  it("moves each piece's words to the recording's time line", () => {
    const words = joinSegments([
      { startSample: 0, words: [{ text: "Esto", start: 100, end: 400 }] },
      { startSample: 17.3 * RATE, words: [{ text: " y esto", start: 200, end: 500 }] },
    ]);
    expect(words).toEqual([
      { text: "Esto", start: 100, end: 400 },
      { text: " y esto", start: 17_500, end: 17_800 },
    ]);
  });
});

describe("joinUnreliable", () => {
  it("moves each piece's unreliable stretches to the recording's time line", () => {
    const spans = joinUnreliable([
      { startSample: 0 },
      { startSample: 17.3 * RATE, unreliable: [{ start: 1_000, end: 9_000 }] },
    ]);
    expect(spans).toEqual([{ start: 18_300, end: 26_300 }]);
  });
});
