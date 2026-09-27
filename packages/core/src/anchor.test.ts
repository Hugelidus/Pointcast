import { describe, expect, it } from "vitest";
import { anchorToSpeech } from "./anchor";
import type { Word } from "./schema";

const OPTS = { pauseMinGapMs: 300, pauseRadiusMs: 1000, longSilenceMs: 3000 };

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

describe("anchorToSpeech", () => {
  it("is standalone at -1 when there are no words at all", () => {
    expect(anchorToSpeech(0, 0, [], OPTS)).toEqual({ kind: "standalone", wordIndex: -1 });
    expect(anchorToSpeech(1_000_000, 1_000_000, [], OPTS)).toEqual({
      kind: "standalone",
      wordIndex: -1,
    });
  });

  it("an interval touching the first word's start (gap 0) counts as overlap, not standalone", () => {
    // intervalGap treats touching intervals as distance 0 everywhere else in this codebase
    // (D4.3); the "before the first word" rule is a strict end < start, so touching is "word".
    const words = [w("Hola", 1000, 1200)];
    expect(anchorToSpeech(500, 1000, words, OPTS)).toEqual({ kind: "word", wordIndex: 0 });
    // Truly before (ends 1ms earlier) is standalone.
    expect(anchorToSpeech(500, 999, words, OPTS)).toEqual({ kind: "standalone", wordIndex: -1 });
  });

  it("an interval touching the last word's end (gap 0) counts as overlap, not standalone", () => {
    const words = [w("Hola", 0, 200)];
    expect(anchorToSpeech(200, 500, words, OPTS)).toEqual({ kind: "word", wordIndex: 0 });
    // Truly after (starts 1ms later) is standalone.
    expect(anchorToSpeech(201, 500, words, OPTS)).toEqual({ kind: "standalone", wordIndex: 0 });
  });

  it("handles a single word with a zero-length interval overlapping it: not standalone", () => {
    const words = [w("Hola", 1000, 1200)];
    expect(anchorToSpeech(1100, 1100, words, OPTS)).toEqual({ kind: "word", wordIndex: 0 });
  });

  it("treats two words with identical start/end (zero-length) without crashing", () => {
    const words = [w("a", 1000, 1000), w("b", 1000, 1000)];
    // Both words occupy the same instant; the event lands exactly on it.
    const result = anchorToSpeech(1000, 1000, words, OPTS);
    expect(result.kind).toBe("word");
    expect([0, 1]).toContain(result.wordIndex);
  });

  it("a pause exactly at pauseMinGapMs counts as a pause", () => {
    const words = [w("a", 0, 100), w("b", 400, 500)];
    // Gap is exactly 300ms == pauseMinGapMs.
    expect(anchorToSpeech(250, 250, words, OPTS)).toEqual({ kind: "pause", wordIndex: 0 });
  });

  it("a gap just below pauseMinGapMs is not a pause; falls through to nearest word", () => {
    const words = [w("a", 0, 100), w("b", 399, 500)];
    // Gap is 299ms, below the 300ms threshold.
    const result = anchorToSpeech(150, 150, words, OPTS);
    expect(result.kind).toBe("word");
  });

  it("a silence exactly at longSilenceMs is NOT long (strict > in the spec)", () => {
    const words = [w("a", 0, 100), w("b", 3100, 3200)];
    // Gap is exactly 3000ms == longSilenceMs; spec says "longer than", so this must not be standalone.
    const result = anchorToSpeech(1500, 1500, words, OPTS);
    expect(result.kind).not.toBe("standalone");
  });

  it("a silence one ms over longSilenceMs is long: standalone", () => {
    const words = [w("a", 0, 100), w("b", 3101, 3200)];
    const result = anchorToSpeech(1500, 1500, words, OPTS);
    expect(result).toEqual({ kind: "standalone", wordIndex: 0 });
  });

  it("picks the earlier pause on a tie between two equidistant pauses", () => {
    const words = [w("a", 0, 100), w("b", 500, 600), w("c", 1000, 1100)];
    // Pause1: 100-500 (400ms wide); pause2: 600-1000 (400ms wide). Event at 550 is 50ms from
    // the end of pause1 (450..500) and 50ms from the start of pause2 (600..650): a true tie.
    // The earlier pause wins; the event is past its midpoint, so it goes with "b", on which it
    // lands (D4 note 2026-09-27). Either pause would have put the marker right after "b".
    const result = anchorToSpeech(550, 550, words, OPTS);
    expect(result).toEqual({ kind: "word", wordIndex: 1 });
  });

  it("splits a pause at its midpoint: the first half goes with the words before, the rest with the words after", () => {
    const words = [w("a", 0, 100), w("b", 500, 600)]; // pause 100-500, midpoint 300
    expect(anchorToSpeech(300, 300, words, OPTS)).toEqual({ kind: "pause", wordIndex: 0 });
    expect(anchorToSpeech(301, 301, words, OPTS)).toEqual({ kind: "word", wordIndex: 1 });
    // Starts in the first half but runs into "b": it goes with "b".
    expect(anchorToSpeech(150, 520, words, OPTS)).toEqual({ kind: "word", wordIndex: 1 });
    // Starts before the pause and runs into "b": it began with "a", so it stays with the pause.
    expect(anchorToSpeech(50, 520, words, OPTS)).toEqual({ kind: "pause", wordIndex: 0 });
  });

  it("picks the earlier word on a tie between two equidistant words", () => {
    const words = [w("uno", 0, 100), w("dos", 300, 400)];
    // Gap of 200ms is below pauseMinGapMs, so no pause; the point 200 is 100ms from both words.
    expect(anchorToSpeech(200, 200, words, OPTS)).toEqual({ kind: "word", wordIndex: 0 });
  });

  it("an interval spanning the whole transcript (a huge selection) is not standalone", () => {
    const words = [w("a", 0, 100), w("b", 5000, 5100), w("c", 10_000, 10_100)];
    // The interval overlaps every word, so gap to at least one word is 0.
    const result = anchorToSpeech(0, 10_100, words, OPTS);
    expect(result.kind).not.toBe("standalone");
  });
});
