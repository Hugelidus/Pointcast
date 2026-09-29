import { describe, expect, it } from "vitest";
import type { Placement } from "@pointcast/core";
import { formatFusionSummary, PREVIEW_CHARS, specStats, summarizeFusion } from "./summary";

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

  it("formats a one-line summary", () => {
    expect(formatFusionSummary({ total: 1, deictic: 1, time: 0, standalone: 0 })).toBe(
      "1 event (1 deictic, 0 time, 0 standalone)",
    );
    expect(formatFusionSummary({ total: 3, deictic: 1, time: 1, standalone: 1 })).toBe(
      "3 events (1 deictic, 1 time, 1 standalone)",
    );
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
