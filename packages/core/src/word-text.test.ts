import { describe, expect, it } from "vitest";
import { isPunctuationOnly, splitWord, usesLeadingSpaces } from "./word-text";
import type { Word } from "./schema";

describe("splitWord", () => {
  it("returns empty parts for an empty token", () => {
    expect(splitWord("")).toEqual({ lead: "", core: "", trailing: "" });
  });

  it("returns empty parts for a token that is only whitespace", () => {
    expect(splitWord("   ")).toEqual({ lead: " ", core: "", trailing: "" });
  });

  it("treats a lone punctuation character as core with no trailing (nothing precedes it)", () => {
    expect(splitWord("!")).toEqual({ lead: "", core: "!", trailing: "" });
    expect(splitWord(" ¿?")).toEqual({ lead: " ", core: "¿?", trailing: "" });
  });

  it("splits an em-dash and other Unicode punctuation as trailing", () => {
    expect(splitWord("word—")).toEqual({ lead: "", core: "word", trailing: "—" });
  });

  it("keeps every trailing punctuation mark, however many", () => {
    expect(splitWord(" wait...?!")).toEqual({ lead: " ", core: "wait", trailing: "...?!" });
  });

  it("does not treat a leading tab or newline character as producing a different lead", () => {
    // Only " lead" is modeled (single space); any leading whitespace still yields lead " ".
    expect(splitWord("\tHola")).toEqual({ lead: " ", core: "Hola", trailing: "" });
    expect(splitWord("\nHola,")).toEqual({ lead: " ", core: "Hola", trailing: "," });
  });
});

describe("usesLeadingSpaces", () => {
  it("is false for a single-word transcript regardless of its own leading space", () => {
    // Only words after the first are checked (D: the first token's leading space is
    // ambiguous - it could just be the engine's start-of-utterance marker).
    expect(usesLeadingSpaces([{ text: " Hola", start: 0, end: 0 }])).toBe(false);
    expect(usesLeadingSpaces([{ text: "Hola", start: 0, end: 0 }])).toBe(false);
  });

  it("is true when only some later words carry a leading space (mixed/partial)", () => {
    const words: Word[] = [
      { text: "Hola", start: 0, end: 0 },
      { text: "mundo", start: 0, end: 0 },
      { text: " otra", start: 0, end: 0 },
    ];
    expect(usesLeadingSpaces(words)).toBe(true);
  });

  it("is false when every word after the first is glued (bare-word engine)", () => {
    const words: Word[] = [
      { text: "Hola", start: 0, end: 0 },
      { text: ",", start: 0, end: 0 },
      { text: "mundo", start: 0, end: 0 },
    ];
    expect(usesLeadingSpaces(words)).toBe(false);
  });
});

describe("isPunctuationOnly", () => {
  it("is false for an empty or whitespace-only token", () => {
    expect(isPunctuationOnly("")).toBe(false);
    expect(isPunctuationOnly("   ")).toBe(false);
  });

  it("recognizes multi-character Unicode punctuation-only tokens", () => {
    expect(isPunctuationOnly("¿?")).toBe(true);
    expect(isPunctuationOnly("—")).toBe(true);
    expect(isPunctuationOnly("«»")).toBe(true);
  });

  it("is false as soon as any letter or digit is present", () => {
    expect(isPunctuationOnly("a.")).toBe(false);
    expect(isPunctuationOnly("2.")).toBe(false);
  });
});
