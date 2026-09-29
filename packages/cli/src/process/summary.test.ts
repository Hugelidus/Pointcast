import { describe, expect, it } from "vitest";
import type { Placement } from "@pointcast/core";
import { formatSpecHeader, PREVIEW_CHARS, specStats, summarizeFusion } from "./summary";

describe("summarizeFusion", () => {
  it("counts each anchor kind directly", () => {
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "pause", wordIndex: 1 },
      { eventId: "e3", kind: "word", wordIndex: 2 },
      { eventId: "e4", kind: "standalone", wordIndex: -1 },
    ];
    expect(summarizeFusion(placements)).toEqual({ total: 4, deictic: 1, time: 2, standalone: 1 });
  });

  it("resolves a burst to its leader's kind, not a bucket of its own", () => {
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "burst", wordIndex: 0, sharedWith: "e1" },
      { eventId: "e3", kind: "standalone", wordIndex: -1 },
      { eventId: "e4", kind: "burst", wordIndex: -1, sharedWith: "e3" },
    ];
    expect(summarizeFusion(placements)).toEqual({ total: 4, deictic: 2, time: 0, standalone: 2 });
  });

});

describe("formatSpecHeader", () => {
  it("says requests, elements and rounded tokens, without jargon or characters", () => {
    expect(formatSpecHeader({ requests: 8, elements: 17, tokens: 3081 })).toBe("8 requests · 17 elements · ~3,100 tokens");
    expect(formatSpecHeader({ requests: 1, elements: 1, tokens: 472 })).toBe("1 request · 1 element · ~470 tokens");
    expect(formatSpecHeader({ requests: 0, elements: 0, tokens: 3 })).toBe("0 requests · 0 elements · ~10 tokens");
    // The classic format has no requests to count.
    expect(formatSpecHeader({ requests: undefined, elements: 10, tokens: 12_345 })).toBe("10 elements · ~12,300 tokens");
  });
});

describe("specStats", () => {
  it("counts the requests and quotes the first one without its pointing markers", () => {
    const markdown = [
      "# UI change requests",
      "",
      "Preamble with [a] in it.",
      "",
      "## Request 1",
      "",
      "> Esto [a] me gustaría \\*así\\* [b, c] y [d–f] ya.",
      "",
      "- [a] th",
      "",
      "## Request 2",
      "",
      "_Pointed at without speaking._",
    ].join("\n");
    expect(specStats(markdown)).toEqual({ requests: 2, preview: "Esto me gustaría *así* y ya." });
  });

  it("cuts a long quote, and has nothing to count in the classic format", () => {
    const long = `## Request 1\n\n> ${"palabra ".repeat(30)}\n`;
    const { preview } = specStats(long);
    expect(Array.from(preview!)).toHaveLength(PREVIEW_CHARS);
    expect(preview!.endsWith("…")).toBe(true);
    expect(specStats("# Session\n\n> said something\n")).toEqual({ requests: undefined, preview: undefined });
  });
});
