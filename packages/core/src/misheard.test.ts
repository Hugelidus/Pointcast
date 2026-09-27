import { describe, expect, it } from "vitest";
import { findMisheard } from "./misheard";
import type { Word } from "./schema";

const words = (...texts: string[]): Word[] =>
  texts.map((text, i) => ({ text, start: i * 100, end: i * 100 + 90 }));

describe("findMisheard", () => {
  it('spots "app y token" as the label «API token»', () => {
    const ws = words(" el", " campo", " app", " y", " token,", " esto");
    expect(findMisheard(ws, 5, 0, 6, ["", "API token"])).toEqual({
      heard: "app y token",
      meant: "API token",
    });
  });

  it("ignores exact mentions and inflections that contain the name", () => {
    const ws = words(" exportar", " el", " Export", " esto");
    expect(findMisheard(ws, 3, 0, 4, ["Export"])).toBeUndefined();
  });

  it("ignores unrelated words and short targets", () => {
    expect(findMisheard(words(" ordena", " por", " cantidad"), 0, 0, 3, ["Quantity"])).toBeUndefined();
    expect(findMisheard(words(" oka", " esto"), 1, 0, 2, ["OK"])).toBeUndefined();
  });

  it("stays within the sentence", () => {
    const ws = words(" app", " y", " token.", " Esto", " sí");
    expect(findMisheard(ws, 3, 3, 5, ["API token"])).toBeUndefined();
  });
});
