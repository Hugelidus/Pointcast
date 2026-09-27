import { intervalGap } from "./interval";
import type { Word } from "./schema";

export interface SpeechAnchorOptions {
  pauseMinGapMs: number;
  pauseRadiusMs: number;
  longSilenceMs: number;
}

/**
 * Where an event with no deictic goes (decision D4.5, after the burst rule).
 * - standalone: the marker gets a line of its own, placed after words[wordIndex] (-1 = before
 *   the first word);
 * - pause: inline, right after words[wordIndex], the word that ends the pause;
 * - word: inline, right after words[wordIndex].
 */
export interface SpeechAnchor {
  kind: "standalone" | "pause" | "word";
  wordIndex: number;
}

/**
 * Anchor the interval [start, end] (an event, or a whole burst of unmatched events) to the
 * transcript. Words must be in time order, as engines produce them. Rules, first match wins:
 *
 * 1. Outside speech → standalone. No words at all → position -1. The interval ends before the
 *    first word starts → -1. It starts after the last word ends → after the last word.
 *    Why: attaching it to the first/last word would suggest the speaker was talking about it.
 * 2. Entirely inside a silence longer than longSilenceMs (the gap between two consecutive
 *    words) → standalone after the word before the silence. The speaker was quiet while
 *    pointing, so no word is really "about" this event.
 * 3. Nearest pause within pauseRadiusMs → inline after the word that precedes the pause.
 *    A pause is a gap of at least pauseMinGapMs between consecutive words; the distance is
 *    the interval gap between the event and the pause (0 when the event is inside it).
 *    Pauses are where people point while thinking, and a marker there does not split a phrase.
 *    But an event that starts after the pause's midpoint, or starts in the pause and runs into
 *    the next word, belongs to what comes next: people point as they start saying what they
 *    point at. It goes after the nearest word from the pause on (kind "word"), so it lands in
 *    the following sentence (D4 note 2026-09-27).
 * 4. Otherwise the nearest word by interval gap → inline after it.
 * Ties in 3 and 4 go to the earlier pause/word, for determinism.
 */
export function anchorToSpeech(
  start: number,
  end: number,
  words: readonly Word[],
  options: SpeechAnchorOptions,
): SpeechAnchor {
  const last = words.length - 1;
  if (last < 0 || end < words[0].start) return { kind: "standalone", wordIndex: -1 };
  if (start > words[last].end) return { kind: "standalone", wordIndex: last };

  for (let k = 0; k < last; k++) {
    const silenceStart = words[k].end;
    const silenceEnd = words[k + 1].start;
    const inside = silenceStart <= start && end <= silenceEnd;
    if (inside && silenceEnd - silenceStart > options.longSilenceMs) {
      return { kind: "standalone", wordIndex: k };
    }
  }

  let bestPause = -1;
  let bestPauseGap = Infinity;
  for (let k = 0; k < last; k++) {
    const pauseStart = words[k].end;
    const pauseEnd = words[k + 1].start;
    if (pauseEnd - pauseStart < options.pauseMinGapMs) continue;
    const gap = intervalGap(start, end, pauseStart, pauseEnd);
    // Strict "<" keeps the earlier pause on ties.
    if (gap <= options.pauseRadiusMs && gap < bestPauseGap) {
      bestPause = k;
      bestPauseGap = gap;
    }
  }
  if (bestPause >= 0) {
    const pauseStart = words[bestPause].end;
    const pauseEnd = words[bestPause + 1].start;
    const following = start > (pauseStart + pauseEnd) / 2 || (start >= pauseStart && end > pauseEnd);
    if (!following) return { kind: "pause", wordIndex: bestPause };
    return { kind: "word", wordIndex: nearestWord(start, end, words, bestPause + 1) };
  }
  return { kind: "word", wordIndex: nearestWord(start, end, words, 0) };
}

/** Index of the word from `from` on closest to [start, end] (interval gap; ties to the earlier). */
function nearestWord(start: number, end: number, words: readonly Word[], from: number): number {
  let bestWord = from;
  let bestWordGap = Infinity;
  for (let k = from; k < words.length; k++) {
    const gap = intervalGap(start, end, words[k].start, words[k].end);
    if (gap < bestWordGap) {
      bestWord = k;
      bestWordGap = gap;
    }
  }
  return bestWord;
}
