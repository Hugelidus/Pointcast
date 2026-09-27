import { describe, expect, it } from "vitest";
import { countChunks } from "./chunks";

describe("countChunks (30 s windows, 5 s stride: a new window every 20 s)", () => {
  const seconds = (s: number) => s * 16000;

  it("uses one window for audio up to 30 s, and without chunking", () => {
    expect(countChunks(seconds(12), 30)).toBe(1);
    expect(countChunks(seconds(30), 30)).toBe(1);
    expect(countChunks(seconds(300), 0)).toBe(1);
  });

  it("adds a window every 20 s after the first 30 s", () => {
    expect(countChunks(seconds(31), 30)).toBe(2);
    expect(countChunks(seconds(50), 30)).toBe(2);
    expect(countChunks(seconds(51), 30)).toBe(3);
    // fixtures/audio/es-2min.wav: 152 s, windows starting at 0, 20, … 140 s.
    expect(countChunks(seconds(152.195), 30)).toBe(8);
  });

  it("honours an explicit stride", () => {
    // 30 s windows, 10 s stride: a new window every 10 s.
    expect(countChunks(seconds(50), 30, 10)).toBe(3);
  });
});
