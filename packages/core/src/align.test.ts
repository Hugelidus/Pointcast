import { describe, expect, it } from "vitest";
import { alignToDeictics, type Span } from "./align";

const COSTS = { windowMs: 2000, unmatchedEventMs: 2500, unmatchedDeicticMs: 300 };

function span(start: number, end = start): Span {
  return { start, end };
}

describe("alignToDeictics", () => {
  it("handles empty events and empty deictics", () => {
    expect(alignToDeictics([], [], COSTS)).toEqual({ pairs: new Map(), costMs: 0 });
  });

  it("leaves every event unmatched when there are deictics but no window fits", () => {
    const result = alignToDeictics([span(0)], [span(10_000)], COSTS);
    expect(result.pairs.size).toBe(0);
    expect(result.costMs).toBe(COSTS.unmatchedEventMs + COSTS.unmatchedDeicticMs);
  });

  it("matches many events to many deictics in order, never crossing pairs", () => {
    // 4 events, 4 deictics, all close: the optimal alignment matches them 1:1 in order.
    const events = [span(0), span(1000), span(2000), span(3000)];
    const deictics = [span(50), span(1050), span(2050), span(3050)];
    const result = alignToDeictics(events, deictics, COSTS);
    expect(result.pairs).toEqual(
      new Map([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    );
    expect(result.costMs).toBe(50 * 4);
  });

  it("never produces a crossing pair, even when each event is closest to the other's deictic", () => {
    // Event 0 is much closer to deictic 1 than to deictic 0, and vice versa for event 1.
    // A crossing assignment (0->1, 1->0) would be cheapest pointwise but is not monotonic;
    // the DP must pick a non-crossing outcome (matching only one side, or none).
    const events = [span(1900), span(100)];
    const deictics = [span(0), span(2000)];
    const result = alignToDeictics(events, deictics, COSTS);
    const pairs = [...result.pairs.entries()];
    for (const [i1, j1] of pairs) {
      for (const [i2, j2] of pairs) {
        if (i1 < i2) expect(j1).toBeLessThan(j2);
      }
    }
    // The cheapest non-crossing option matches event 1 (100) to deictic 0 (0), cost 100,
    // and leaves event 0 and deictic 1 unmatched: 100 + 2500 + 300 = 2900.
    expect(result.pairs).toEqual(new Map([[1, 0]]));
    expect(result.costMs).toBe(2900);
  });

  it("ties break toward leaving the later deictic unmatched, then the later event", () => {
    // Two deictics equally reachable from one event: 0 wins (earlier deictic).
    const events = [span(1000)];
    const deictics = [span(0), span(2000)];
    const result = alignToDeictics(events, deictics, COSTS);
    expect(result.pairs).toEqual(new Map([[0, 0]]));
  });

  it("is deterministic for identical input", () => {
    const events = [span(0), span(1000), span(5000)];
    const deictics = [span(100), span(4900)];
    const first = alignToDeictics(events, deictics, COSTS);
    for (let i = 0; i < 5; i++) {
      expect(alignToDeictics(events, deictics, COSTS)).toEqual(first);
    }
  });

  it("adds an event's matchPenaltyMs to its match cost", () => {
    // Without the penalty the second event (0 ms away) would win over the first (300 ms).
    const events = [span(700), { ...span(1100), matchPenaltyMs: 500 }];
    const result = alignToDeictics(events, [span(1000, 1200)], COSTS);
    expect(result.pairs).toEqual(new Map([[0, 0]]));
    expect(result.costMs).toBe(300 + COSTS.unmatchedEventMs);
  });

  it("applies the window to the gap alone, never to gap + penalty", () => {
    // 1900 ms away: within the 2000 ms window even though 1900 + 500 is not.
    const result = alignToDeictics([{ ...span(3100), matchPenaltyMs: 500 }], [span(1000, 1200)], COSTS);
    expect(result.pairs).toEqual(new Map([[0, 0]]));
    expect(result.costMs).toBe(2400);
  });

  it("treats overlapping intervals as distance 0 regardless of order", () => {
    const events = [span(1000, 2000)];
    const deictics = [span(1500, 1500)];
    const result = alignToDeictics(events, deictics, COSTS);
    expect(result.pairs).toEqual(new Map([[0, 0]]));
    expect(result.costMs).toBe(0);
  });
});
