import { describe, expect, it } from "vitest";
import { nounTarget, spokenNoun } from "./nouns";
import type { Word } from "./schema";

const words = (...texts: string[]): Word[] =>
  texts.map((text, i) => ({ text, start: i * 100, end: i * 100 + 90 }));

const CELL = "main › section#orders › table#orders-table › tbody › tr[1] › td[5] › button";

describe("spokenNoun", () => {
  it("prefers the word after the deictic, keeps the word as said without punctuation", () => {
    expect(spokenNoun(words(" Este", " botón,", " tabla"), 0, 0, 3)).toEqual({
      word: "botón",
      kind: "button",
    });
  });

  it("looks before the anchor too, within the sentence only", () => {
    const ws = words(" la", " tabla", " esta", " no.");
    expect(spokenNoun(ws, 2, 0, 4)?.kind).toBe("table");
    expect(spokenNoun(ws, 2, 2, 4)).toBeUndefined();
  });

  it("knows English nouns", () => {
    expect(spokenNoun(words(" this", " header"), 0, 0, 2)?.kind).toBe("bar");
  });
});

describe("nounTarget", () => {
  it("finds the nearest matching ancestor as a path prefix", () => {
    expect(nounTarget("table", CELL)).toBe("`main › section#orders › table#orders-table`");
    expect(nounTarget("row", CELL)).toBe(
      "`main › section#orders › table#orders-table › tbody › tr[1]`",
    );
    expect(nounTarget("bar", "header › nav«Main» › a[2]")).toBe("`header › nav«Main»`");
    expect(nounTarget("bar", "main › div.toolbar › button[2]")).toBe("`main › div.toolbar`");
    expect(nounTarget("title", "main › header › h1 › span")).toBe("`main › header › h1`");
  });

  it("says nothing when the element itself is the thing, or nothing matches", () => {
    expect(nounTarget("button", CELL)).toBeUndefined();
    expect(nounTarget("field", CELL)).toBeUndefined();
  });

  it("describes a column by position, from a cell or anything inside it", () => {
    expect(nounTarget("column", CELL)).toBe(
      "column 5 of `main › section#orders › table#orders-table` (its header and the cell at that position in every row)",
    );
    expect(nounTarget("column", "main › div › span")).toBeUndefined();
  });
});
