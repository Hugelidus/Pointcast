import { describe, expect, it } from "vitest";
import type { Word } from "./schema";
import { splitSentences } from "./sentences";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("splitSentences", () => {
  it("splits on Whisper punctuation", () => {
    const words = [
      w(" Mira", 0, 100),
      w(" esto.", 100, 200),
      w(" ¿Y", 300, 400),
      w(" aquí?", 400, 500),
      w(" Vale", 600, 700),
    ];
    expect(splitSentences(words, 2000)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 5 },
    ]);
  });

  it("falls back to pauses when there is no punctuation", () => {
    const words = [w("move", 0, 300), w("this", 300, 600), w("make", 3000, 3300), w("it", 3300, 3500)];
    expect(splitSentences(words, 2000)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("treats closing quotes after the period as a sentence end", () => {
    expect(splitSentences([w(" «Guardar».", 0, 100), w(" Y", 200, 300)], 2000)).toHaveLength(2);
  });

  it("returns nothing for no words", () => {
    expect(splitSentences([], 2000)).toEqual([]);
  });
});
