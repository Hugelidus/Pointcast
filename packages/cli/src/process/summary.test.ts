import { describe, expect, it } from "vitest";
import type { Placement } from "@pointcast/core";
import { formatFusionSummary, summarizeFusion } from "./summary";

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
