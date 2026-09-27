import { intervalGap } from "./interval";

/** Anything with a time interval in ms: events use tStart/tEnd, words start/end. */
export interface Span {
  start: number;
  end: number;
}

/** An event for the alignment: its interval, plus an extra cost for any match it takes part in. */
export interface AlignEvent extends Span {
  /**
   * Added to the cost of matching this event to any deictic (integer ms-scaled units, like
   * every other cost here). Used for D7's plain-click penalty. The window still applies to
   * the gap alone: the penalty makes a match more expensive, never impossible.
   */
  matchPenaltyMs?: number;
}

/** DP costs, all in integer milliseconds (see alignToDeictics for why). */
export interface AlignCosts {
  windowMs: number;
  unmatchedEventMs: number;
  unmatchedDeicticMs: number;
}

export interface Alignment {
  /** Index into `events` -> index into `deictics`. */
  pairs: Map<number, number>;
  /** Total cost of the optimal alignment, in ms-scaled units. */
  costMs: number;
}

/**
 * Monotonic alignment of time-sorted events against deictic words (decision D4.4).
 *
 * It is the edit-distance DP used by `diff`: we assume people point in the same order in
 * which they speak, so pairs never cross. Each cell chooses the cheapest of:
 * - leave the event unmatched   (unmatchedEventMs; plus the deictic's own unmatched cost it
 *                                 outweighs any valid match, so a possible match is taken);
 * - leave the deictic unmatched (unmatchedDeicticMs, cheap: "this" is often said without pointing);
 * - match them                  (their gap in ms plus the event's matchPenaltyMs, only when
 *                                 the gap alone is <= windowMs).
 *
 * Costs are integers (seconds x 1000) so that ties are exact: with floats 0.1 + 0.2 !== 0.3,
 * and a "tie" could silently depend on rounding.
 *
 * Tie-breaking, applied while walking back from the last cell: prefer leaving the LATER
 * deictic unmatched, then the LATER event, and only then matching. Walking backwards, this
 * keeps earlier items available to pair, so among equally cheap alignments we pick the one
 * that pairs earlier events with earlier words. Deterministic for identical input.
 */
export function alignToDeictics(
  events: readonly AlignEvent[],
  deictics: readonly Span[],
  costs: AlignCosts,
): Alignment {
  const n = events.length;
  const m = deictics.length;
  // dp[i][j] = cheapest alignment of the first i events with the first j deictics.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const matchCost = (i: number, j: number): number | undefined => {
    const e = events[i - 1];
    const d = deictics[j - 1];
    const gap = intervalGap(e.start, e.end, d.start, d.end);
    return gap <= costs.windowMs ? gap + (e.matchPenaltyMs ?? 0) : undefined;
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      if (i > 0) best = Math.min(best, dp[i - 1][j] + costs.unmatchedEventMs);
      if (j > 0) best = Math.min(best, dp[i][j - 1] + costs.unmatchedDeicticMs);
      if (i > 0 && j > 0) {
        const cost = matchCost(i, j);
        if (cost !== undefined) best = Math.min(best, dp[i - 1][j - 1] + cost);
      }
      dp[i][j] = best;
    }
  }

  const pairs = new Map<number, number>();
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = dp[i][j];
    if (j > 0 && here === dp[i][j - 1] + costs.unmatchedDeicticMs) {
      j--;
    } else if (i > 0 && here === dp[i - 1][j] + costs.unmatchedEventMs) {
      i--;
    } else {
      // By elimination the cell came from a match (both indices are > 0 here).
      pairs.set(i - 1, j - 1);
      i--;
      j--;
    }
  }

  return { pairs, costMs: dp[n][m] };
}
