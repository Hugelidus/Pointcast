import type { Placement } from "./fuse";
import type { CapturedEvent, Word } from "./schema";
import { SENTENCE_END, type Sentence } from "./sentences";

/**
 * Units of the requests format and the rule that joins a spoken utterance without gestures to
 * the request it belongs to (D4 note 2026-09-28).
 */

export interface Pointed {
  event: CapturedEvent;
  placement: Placement;
}

/**
 * One request: a sentence and the elements pointed at during it, a typed note and its one
 * element (typed sessions, D12), or a gap pointed at without speaking or without a note.
 */
export interface Unit {
  /** Words quoted by the request: one sentence, or two adjacent ones joined by mergeUtterances. */
  sentence?: Sentence;
  /**
   * The sentences `sentence` was joined from, in order (undefined: just `sentence`). The noun and
   * misheard-name lookups stay inside the sentence of each gesture, as before the join.
   */
  parts?: Sentence[];
  note?: string;
  pointed: Pointed[];
}

/** (a) A silent pointing takes the utterance that starts at most this long after its last gesture. */
export const SILENT_POINTING_GAP_MS = 6000;
/** (b) A request with gestures takes the utterance that starts at most this long after it ends. */
export const CONTINUATION_GAP_MS = 4000;
/** (c) A lead-in joins the request with gestures that starts at most this long after it ends. */
export const LEAD_IN_GAP_MS = 4000;
/** (c) A lead-in has at most this many words and no sentence-ending punctuation ("Luego en Proceso,"). */
export const LEAD_IN_MAX_WORDS = 6;
/** (a), (b) A longer utterance is a request of its own: it says more than a follow-up does. */
export const ATTACH_MAX_WORDS = 20;
/**
 * (d) A pointing without speaking that starts at most this long before the next request's first
 * word belongs to that request: people point as they start talking.
 */
export const GESTURE_LEAD_IN_MS = 1000;

/**
 * Joins each utterance said without pointing (a sentence with no gestures) to the adjacent
 * request it belongs to, when the times say so; otherwise it stays a request of its own. In order
 * of precedence:
 *
 * (c) lead-in: at most LEAD_IN_MAX_WORDS words with no sentence-ending punctuation (the pause cut
 *     it, the user had not finished), and the next request has gestures and starts at most
 *     LEAD_IN_GAP_MS after it: prepended to that request ("Luego en Proceso, aquí [a] …").
 * (a) the request before it is a pointing without speaking whose last gesture ends at most
 *     SILENT_POINTING_GAP_MS before the utterance starts: the utterance becomes its speech, with
 *     the markers before the first word, where the pointing happened ("[a] y hay que arreglar …").
 * (b) the request before it has gestures and ends at most CONTINUATION_GAP_MS before the utterance
 *     starts: appended to that request's quote ("… chips de aquí [e]. no me gustan …").
 *
 * Gestures move too, the other way round (D4 note 2026-09-29):
 * (d) gesture just before speech: a pointing without speaking whose gestures all start at most
 *     GESTURE_LEAD_IN_MS before the first word of the next request, said while pointing, joins
 *     that request, marked before its first word ("[a] y la tarjeta de pedidos [b] hay que …").
 *     People point as they start talking, and the gesture fell in the silence only by a few
 *     hundred milliseconds. An utterance said without pointing after it takes the pointing by (a)
 *     already. (d) moves gestures, not words: the request can still take an utterance.
 *
 * (a) and (b) take utterances of at most ATTACH_MAX_WORDS words, and a request takes at most one
 * utterance, so a monologue never snowballs into one request. Units are adjacent in time (a
 * gesture between two sentences is a unit of its own between them), so "adjacent" already means
 * "no other gesture in between". The quote keeps the user's words: a joined sentence is the
 * range of words of both, in order, never rewritten.
 */
export function mergeUtterances(units: readonly Unit[], words: readonly Word[]): Unit[] {
  const pending = [...units];
  const out: Unit[] = [];
  const joined = new Set<Unit>();
  for (let i = 0; i < pending.length; i++) {
    const unit = pending[i];
    const next = pending[i + 1];
    if (
      isSilentPointing(unit) &&
      next !== undefined &&
      isSaid(next) &&
      start(next.sentence, words) - firstGestureStart(unit) <= GESTURE_LEAD_IN_MS
    ) {
      const merged: Unit = { ...next, pointed: [...unit.pointed, ...next.pointed] };
      if (joined.has(next)) joined.add(merged);
      pending[i + 1] = merged;
      continue;
    }
    if (!isBare(unit)) {
      out.push(unit);
      continue;
    }
    const sentence = unit.sentence;
    const count = sentence.to - sentence.from;
    if (
      next !== undefined &&
      isSaid(next) &&
      !joined.has(next) &&
      count <= LEAD_IN_MAX_WORDS &&
      !SENTENCE_END.test(words[sentence.to - 1].text.trimEnd()) &&
      start(next.sentence, words) - end(sentence, words) <= LEAD_IN_GAP_MS
    ) {
      const merged: Unit = {
        sentence: { from: sentence.from, to: next.sentence.to },
        parts: [sentence, ...partsOf(next)],
        pointed: next.pointed,
      };
      joined.add(merged);
      pending[i + 1] = merged;
      continue;
    }
    const previous = out.at(-1);
    if (previous !== undefined && !joined.has(previous) && count <= ATTACH_MAX_WORDS) {
      if (isSilentPointing(previous) && start(sentence, words) - lastGestureEnd(previous) <= SILENT_POINTING_GAP_MS) {
        const merged: Unit = { sentence, parts: [sentence], pointed: previous.pointed };
        joined.add(merged);
        out[out.length - 1] = merged;
        continue;
      }
      if (isSaid(previous) && start(sentence, words) - end(previous.sentence, words) <= CONTINUATION_GAP_MS) {
        const merged: Unit = {
          sentence: { from: previous.sentence.from, to: sentence.to },
          parts: [...partsOf(previous), sentence],
          pointed: previous.pointed,
        };
        joined.add(merged);
        out[out.length - 1] = merged;
        continue;
      }
    }
    out.push(unit);
  }
  return out;
}

/** The sentence of a unit's gesture word, for lookups that must not cross into a joined sentence. */
export function partOf(unit: Unit, wordIndex: number): Sentence | undefined {
  return partsOf(unit).find((part) => wordIndex >= part.from && wordIndex < part.to);
}

function partsOf(unit: Unit): Sentence[] {
  return unit.parts ?? (unit.sentence ? [unit.sentence] : []);
}

type Spoken = Unit & { sentence: Sentence };

/** Said without pointing: a sentence and no gesture. */
function isBare(unit: Unit): unit is Spoken {
  return unit.sentence !== undefined && unit.note === undefined && unit.pointed.length === 0;
}

/** Pointed at without speaking (and without a note): gestures, no sentence. */
function isSilentPointing(unit: Unit): boolean {
  return unit.sentence === undefined && unit.note === undefined && unit.pointed.length > 0;
}

/** Said while pointing: a sentence with gestures. */
function isSaid(unit: Unit): unit is Spoken {
  return unit.sentence !== undefined && unit.note === undefined && unit.pointed.length > 0;
}

function start(sentence: Sentence, words: readonly Word[]): number {
  return words[sentence.from].start;
}

function end(sentence: Sentence, words: readonly Word[]): number {
  return words[sentence.to - 1].end;
}

function firstGestureStart(unit: Unit): number {
  return Math.min(...unit.pointed.map(({ event }) => event.tStart));
}

function lastGestureEnd(unit: Unit): number {
  return Math.max(...unit.pointed.map(({ event }) => event.tEnd));
}
