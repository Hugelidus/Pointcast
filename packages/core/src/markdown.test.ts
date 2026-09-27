import { describe, expect, it } from "vitest";
import {
  codeSpan,
  escapeLineStart,
  escapeMarkdown,
  fencedBlock,
  inlineText,
  truncate,
} from "./markdown";

describe("escapeMarkdown", () => {
  it("escapes characters that would start emphasis, links, code or HTML", () => {
    expect(escapeMarkdown("a*b_c`d[e]f<g>h~i\\j")).toBe(
      "a\\*b\\_c\\`d\\[e\\]f\\<g\\>h\\~i\\\\j",
    );
  });

  it("leaves ordinary text and non-ASCII punctuation alone", () => {
    expect(escapeMarkdown("¿Qué tal? «Hola» — sí.")).toBe("¿Qué tal? «Hola» — sí.");
  });
});

describe("inlineText", () => {
  it("collapses newlines and runs of whitespace, trims and escapes", () => {
    expect(inlineText("  first\n\nsecond *line*\t ")).toBe("first second \\*line\\*");
  });
});

describe("truncate", () => {
  it("keeps short text and cuts long text with an ellipsis within the limit", () => {
    expect(truncate("Quantity", 10)).toBe("Quantity");
    expect(truncate("Export filtered rows", 10)).toBe("Export fi…");
    expect(truncate("Export filtered rows", 10).length).toBe(10);
  });

  it("never cuts a surrogate pair in half, leaving an invalid lone surrogate", () => {
    // "🎉" is a surrogate pair (2 UTF-16 code units, .length === 2). A hard cut at an odd
    // offset would otherwise slice through the middle of one, e.g. label "🎉🎉🎉🎉🎉" (10 units).
    const emojis = "🎉🎉🎉🎉🎉";
    const out = truncate(emojis, 4);
    expect(out.length).toBeLessThanOrEqual(4);
    // A lone (unpaired) high surrogate would make this string not round-trip through
    // Array.from/spread without producing replacement characters.
    expect([...out]).not.toContain("\uD83C");
    expect(out).toBe("🎉…");
  });

  it("still cuts cleanly when the budget happens to land on a pair boundary", () => {
    const emojis = "🎉🎉🎉🎉🎉";
    expect(truncate(emojis, 5)).toBe("🎉🎉…");
    expect(truncate(emojis, 3)).toBe("🎉…");
  });
});

describe("codeSpan", () => {
  it("uses single backticks for plain content", () => {
    expect(codeSpan("#orders > th")).toBe("`#orders > th`");
  });

  it("uses a longer fence than any backtick run inside, padding when needed", () => {
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("`x``")).toBe("``` `x`` ```");
  });

  it("keeps the span on one line", () => {
    expect(codeSpan("a\nb")).toBe("`a b`");
  });
});

describe("fencedBlock", () => {
  it("uses at least three backticks and more when the content has a longer run", () => {
    expect(fencedBlock("<b>x</b>", "html")).toBe("```html\n<b>x</b>\n```");
    expect(fencedBlock("a ```` b", "html")).toBe("`````html\na ```` b\n`````");
  });
});

describe("escapeLineStart", () => {
  it("neutralizes block syntax at the start of a paragraph", () => {
    expect(escapeLineStart("# not a heading")).toBe("\\# not a heading");
    expect(escapeLineStart("- not a list")).toBe("\\- not a list");
    expect(escapeLineStart("+ nope")).toBe("\\+ nope");
    expect(escapeLineStart("= nope")).toBe("\\= nope");
    expect(escapeLineStart("3. not a list")).toBe("3\\. not a list");
    expect(escapeLineStart("12) no")).toBe("12\\) no");
    expect(escapeLineStart("Normal text.")).toBe("Normal text.");
  });
});
