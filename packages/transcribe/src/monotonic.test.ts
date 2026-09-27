import { describe, expect, it } from "vitest";
import type { Word } from "@pointcast/core";
import { dropReemittedWords } from "./monotonic";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("dropReemittedWords", () => {
  it("drops a span repeated at a chunk boundary (real output of whisper-base on es-2min.wav)", () => {
    const words = [
      w(" Es", 45980, 46000),
      w(" decir,", 46260, 46660),
      w(" por", 49500, 49740),
      w(" cliente,", 49740, 49980),
      // The next chunk starts again from its overlap with the previous one.
      w(" Es", 46000, 46280),
      w(" decir,", 46280, 46640),
      w(" por", 49500, 49740),
      w(" cliente,", 49740, 50360),
      w(" y", 52320, 52560),
      w(" después", 52560, 52860),
    ];
    expect(dropReemittedWords(words).map((word) => `${word.text.trim()}@${word.start}`)).toEqual([
      "Es@45980",
      "decir,@46260",
      "por@49500",
      "cliente,@49740",
      "y@52320",
      "después@52560",
    ]);
  });

  it("keeps normal output unchanged, including words that share a boundary or overlap slightly", () => {
    const words = [w(" a", 0, 200), w(" b", 200, 400), w(" c", 380, 600), w(" d", 600, 600), w(" e", 600, 900)];
    expect(dropReemittedWords(words)).toEqual(words);
  });

  it("returns start times that never decrease", () => {
    const words = [w("a", 1000, 1200), w("b", 1200, 1500), w("a", 900, 1100), w("b", 1100, 1500), w("c", 1600, 1800)];
    const starts = dropReemittedWords(words).map((word) => word.start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect(starts).toEqual([1000, 1200, 1600]);
  });

  it("handles empty input", () => {
    expect(dropReemittedWords([])).toEqual([]);
  });
});
