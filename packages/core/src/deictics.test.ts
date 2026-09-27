import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEICTICS,
  DEICTICS_DE,
  DEICTICS_EN,
  DEICTICS_ES,
  DEICTICS_FR,
  DEICTICS_IT,
  DEICTICS_PT,
  deicticsForLanguage,
  isDeictic,
  normalizeWord,
} from "./deictics";

describe("normalizeWord", () => {
  it.each([
    ["Esto,", "esto"],
    ["Aquí", "aqui"],
    [" This.", "this"],
    ["¿Ahí?", "ahi"],
    ["«Allí»", "alli"],
    ["  acá...  ", "aca"],
    ["I'd", "id"],
    ["", ""],
    ["...", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeWord(input)).toBe(expected);
  });
});

describe("deictic lists", () => {
  it("are stored normalized, so lookups never depend on accents", () => {
    for (const word of [
      ...DEICTICS_ES,
      ...DEICTICS_EN,
      ...DEICTICS_FR,
      ...DEICTICS_DE,
      ...DEICTICS_PT,
      ...DEICTICS_IT,
    ]) {
      expect(normalizeWord(word)).toBe(word);
    }
  });

  it("default list is the union of Spanish and English", () => {
    expect(new Set(DEFAULT_DEICTICS)).toEqual(new Set([...DEICTICS_ES, ...DEICTICS_EN]));
  });
});

describe("isDeictic", () => {
  it("recognizes Spanish and English deictics with punctuation and accents", () => {
    for (const word of [" Esto,", "aquí.", "Aquella", " these", "THERE!", "ahí"]) {
      expect(isDeictic(word)).toBe(true);
    }
  });

  it("rejects ordinary words", () => {
    for (const word of [" tabla", "the", "estoy", "they", ""]) {
      expect(isDeictic(word)).toBe(false);
    }
  });

  it('does not confuse the verb "está" with the deictic "esta"', () => {
    expect(isDeictic(" está")).toBe(false);
    expect(isDeictic("Está,")).toBe(false);
    expect(isDeictic(" esta")).toBe(true);
    // Old orthography marks the pronoun with an accent: still a deictic.
    expect(isDeictic(" ésta")).toBe(true);
  });

  it("accepts a custom list, normalizing its entries", () => {
    const list = ["Voilà", "ceci"];
    expect(isDeictic(" voila,", list)).toBe(true);
    expect(isDeictic("Ceci", list)).toBe(true);
    expect(isDeictic("this", list)).toBe(false);
  });

  it("recognizes uppercase accented Spanish deictics", () => {
    expect(isDeictic("AQUÍ")).toBe(true);
    expect(isDeictic(" ¡ESTO!")).toBe(true);
  });

  it('does not treat "that\'s" as the deictic "that"', () => {
    // The apostrophe is stripped, not replaced with a break: "that's" -> "thats", which is
    // not "that". A contraction only counts if the caller explicitly adds "thats" to the list.
    expect(isDeictic("that's")).toBe(false);
    expect(isDeictic("That's,")).toBe(false);
    expect(isDeictic("that's", ["thats"])).toBe(true);
  });
});

describe("deicticsForLanguage", () => {
  it("keeps the Spanish + English default for es, en and unknown languages", () => {
    for (const language of ["es", "en", "en-US", undefined, "ja"]) {
      expect(deicticsForLanguage(language)).toBe(DEFAULT_DEICTICS);
    }
  });

  it.each([
    ["fr", " Ceci,", " cette"],
    ["de", " Das", " hier."],
    ["pt-BR", " Isto", " aquele"],
    ["it", " Questo,", " qui."],
  ])("%s recognizes its own deictics plus English", (language, a, b) => {
    const list = deicticsForLanguage(language);
    for (const word of [a, b, " this"]) expect(isDeictic(word, list)).toBe(true);
  });

  it("only uses German da/das for German, where they are not ordinary words", () => {
    expect(isDeictic(" da")).toBe(false);
    expect(isDeictic(" da", deicticsForLanguage("it"))).toBe(false);
    expect(isDeictic(" da", deicticsForLanguage("de"))).toBe(true);
  });

  it("leaves out accent-only forms that would become articles (French là -> la)", () => {
    expect(isDeictic(" la", deicticsForLanguage("fr"))).toBe(false);
    expect(isDeictic(" la", deicticsForLanguage("it"))).toBe(false);
  });

  it('keeps rejecting the Portuguese verb "está"', () => {
    expect(isDeictic(" está", deicticsForLanguage("pt"))).toBe(false);
  });
});
