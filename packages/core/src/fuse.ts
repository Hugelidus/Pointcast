import { alignToDeictics, type Span } from "./align";
import { anchorToSpeech } from "./anchor";
import { DEFAULT_DEICTICS, deicticSet, isDeictic } from "./deictics";
import { urlLabel } from "./describe";
import { intervalGap } from "./interval";
import type { CapturedEvent, Word } from "./schema";

export { intervalGap } from "./interval";

/**
 * Fusion parameters (decision D4). Times in ms; costs in "seconds" as D4 states them, except
 * clickMatchPenaltyMs, a cost given as the extra distance it amounts to.
 */
export interface FuseOptions {
  /** A deictic can only be matched to an event at most this far away. */
  windowMs: number;
  /** Cost of leaving an event without a deictic; higher than any valid match. */
  costUnmatchedEvent: number;
  /** Cost of a deictic without an event; cheap, people say "this" without pointing. */
  costUnmatchedDeictic: number;
  /**
   * Extra match cost for a plain `click`, as if it were this much farther from the word (D7).
   * An Alt+click point or a selection is a deliberate gesture; a plain click may just be using
   * the app. So point and select win ties and near-ties, and a click still matches when no
   * pointing gesture is nearby. 0 treats all gestures equally.
   */
  clickMatchPenaltyMs: number;
  /**
   * Events chained at most this far apart form a burst that shares one anchor. A burst never
   * spans a URL change (compared as the transcript's URL separators compare pages).
   */
  burstGapMs: number;
  /** A gap between words counts as a pause from this length on. */
  pauseMinGapMs: number;
  /** An unmatched event looks for a pause at most this far away. */
  pauseRadiusMs: number;
  /** An event inside a silence longer than this gets a line of its own. */
  longSilenceMs: number;
  /** Deictic words; normalized before use, so accents and case do not matter. */
  deictics: readonly string[];
}

export const DEFAULT_FUSE_OPTIONS: Readonly<FuseOptions> = {
  windowMs: 2000,
  costUnmatchedEvent: 2.5,
  costUnmatchedDeictic: 0.3,
  clickMatchPenaltyMs: 500,
  burstGapMs: 1000,
  pauseMinGapMs: 300,
  pauseRadiusMs: 1000,
  longSilenceMs: 3000,
  deictics: DEFAULT_DEICTICS,
};

/**
 * How an event was anchored:
 * - deictic:    matched to a deictic word by the alignment;
 * - burst:      shares the anchor of another event of its burst (see `sharedWith`);
 * - pause:      no deictic; placed at the nearest pause;
 * - word:       no deictic, no pause nearby; placed after the nearest word;
 * - standalone: during a long silence or outside speech; gets a line of its own.
 */
export type AnchorKind = "deictic" | "burst" | "pause" | "word" | "standalone";

export interface Placement {
  eventId: string;
  kind: AnchorKind;
  /**
   * Index into the words array.
   * Inline kinds (deictic, pause, word, and a burst sharing one of them): the marker goes
   * right after words[wordIndex].
   * Standalone (and a burst sharing a standalone): the line goes after words[wordIndex];
   * -1 means before the first word.
   */
  wordIndex: number;
  /** Burst only: id of the event whose anchor this one copies. That event is never a burst. */
  sharedWith?: string;
}

export interface FusionResult {
  /** One placement per event, in time order (tStart, then tEnd, then input order). */
  placements: Placement[];
  /** Total cost of the deictic alignment, in D4 units (seconds). Useful to compare tunings. */
  alignmentCost: number;
}

/**
 * Decide where each event goes in the transcript (decision D4). Pure and deterministic.
 * Words are expected in time order, as transcription engines produce them.
 *
 * 1. Sort events by time and align them to deictic words with a monotonic DP (align.ts).
 *    A plain click pays clickMatchPenaltyMs on top of its distance (D7).
 * 2. Group events into bursts: in time order, an event joins the current burst when it starts
 *    at most burstGapMs after the latest end so far in that burst (so a chain of close clicks
 *    is one burst even if its ends are far apart: "these three columns" + 3 clicks), and it is
 *    on the same page (urlLabel, the key the transcript's URL separators use). Why: a burst
 *    renders as one marker, and one marker cannot sit on both sides of a URL separator.
 * 3. Burst with at least one matched event: every unmatched member copies the anchor of the
 *    nearest matched member (interval gap; ties to the earlier one).
 * 4. Burst with no matched event: the burst is anchored once, as a unit, using its whole time
 *    span (anchor.ts: standalone, pause or word). Its first event gets that anchor and the
 *    rest are bursts sharing it, so a rapid series of clicks never scatters over the text.
 */
export function fuse(
  events: readonly CapturedEvent[],
  words: readonly Word[],
  options: Partial<FuseOptions> = {},
): FusionResult {
  const opts: FuseOptions = { ...DEFAULT_FUSE_OPTIONS, ...options };
  const sorted = sortByTime(events);
  const spans: Span[] = sorted.map((e) => ({ start: e.tStart, end: e.tEnd }));

  const set = deicticSet(opts.deictics);
  const deicticIndices: number[] = [];
  words.forEach((word, k) => {
    if (isDeictic(word.text, set)) deicticIndices.push(k);
  });

  const clickPenaltyMs = Math.round(opts.clickMatchPenaltyMs);
  const alignEvents = sorted.map((e, i) => ({
    ...spans[i],
    matchPenaltyMs: e.gesture === "click" ? clickPenaltyMs : 0,
  }));
  const alignment = alignToDeictics(alignEvents, deicticIndices.map((k) => words[k]), {
    windowMs: opts.windowMs,
    unmatchedEventMs: Math.round(opts.costUnmatchedEvent * 1000),
    unmatchedDeicticMs: Math.round(opts.costUnmatchedDeictic * 1000),
  });

  const placements: Placement[] = new Array(sorted.length);
  for (const [eventIndex, deicticIndex] of alignment.pairs) {
    placements[eventIndex] = {
      eventId: sorted[eventIndex].id,
      kind: "deictic",
      wordIndex: deicticIndices[deicticIndex],
    };
  }

  const pages = sorted.map((e) => urlLabel(e.url));
  for (const burst of burstsOf(spans, pages, opts.burstGapMs)) {
    const matched = burst.filter((i) => alignment.pairs.has(i));
    if (matched.length > 0) {
      for (const i of burst) {
        if (alignment.pairs.has(i)) continue;
        const leader = nearest(spans[i], matched, spans);
        placements[i] = {
          eventId: sorted[i].id,
          kind: "burst",
          wordIndex: placements[leader].wordIndex,
          sharedWith: sorted[leader].id,
        };
      }
      continue;
    }

    const start = Math.min(...burst.map((i) => spans[i].start));
    const end = Math.max(...burst.map((i) => spans[i].end));
    const anchor = anchorToSpeech(start, end, words, opts);
    const [leader, ...followers] = burst;
    placements[leader] = { eventId: sorted[leader].id, ...anchor };
    for (const i of followers) {
      placements[i] = {
        eventId: sorted[i].id,
        kind: "burst",
        wordIndex: anchor.wordIndex,
        sharedWith: sorted[leader].id,
      };
    }
  }

  return { placements, alignmentCost: alignment.costMs / 1000 };
}

/** Stable time sort; input order breaks exact ties so the result never depends on the engine. */
function sortByTime(events: readonly CapturedEvent[]): CapturedEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event.tStart - b.event.tStart || a.event.tEnd - b.event.tEnd || a.index - b.index,
    )
    .map(({ event }) => event);
}

/**
 * Split time-sorted spans into bursts (lists of indices), chaining by burstGapMs.
 * `pages[i]` is span i's page; a change of page always starts a new burst.
 */
function burstsOf(spans: readonly Span[], pages: readonly string[], burstGapMs: number): number[][] {
  const bursts: number[][] = [];
  let current: number[] = [];
  let currentEnd = -Infinity;
  spans.forEach((span, i) => {
    const newPage = current.length > 0 && pages[i] !== pages[current[0]];
    if (current.length > 0 && (newPage || span.start - currentEnd > burstGapMs)) {
      bursts.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(i);
    currentEnd = Math.max(currentEnd, span.end);
  });
  if (current.length > 0) bursts.push(current);
  return bursts;
}

/** Index (from candidates, ascending) of the span closest to `target`; ties to the earlier. */
function nearest(target: Span, candidates: readonly number[], spans: readonly Span[]): number {
  let best = candidates[0];
  let bestGap = Infinity;
  for (const c of candidates) {
    const gap = intervalGap(target.start, target.end, spans[c].start, spans[c].end);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}
