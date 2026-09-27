import { urlLabel } from "./describe";
import type { Placement } from "./fuse";
import { escapeLineStart, escapeMarkdown } from "./markdown";
import { renderMarker } from "./marker";
import type { CapturedEvent, Word } from "./schema";
import { SENTENCE_END } from "./sentences";
import { isPunctuationOnly, splitWord, usesLeadingSpaces } from "./word-text";

export interface TranscriptOptions {
  /** Target length of one element's part of an inline marker (D5: ~80). */
  markerBudget: number;
  /** A gap between words at least this long starts a new paragraph. */
  paragraphPauseMs: number;
}

/**
 * Events rendered together: one inline bracket after a word, or one standalone line.
 * `wordIndex` means "after words[wordIndex]" in both cases (-1 = before the first word).
 */
interface Slot {
  standalone: boolean;
  wordIndex: number;
  events: CapturedEvent[];
}

/**
 * The transcript as Markdown blocks (paragraphs, standalone marker lines, URL separators),
 * ready to be joined with blank lines.
 *
 * The document is a walk over "positions": position p is the boundary before words[p]
 * (p = words.length is the end). Paragraph breaks, standalone lines and URL separators are
 * all attached to positions; inline markers are attached to words.
 */
export function renderTranscript(
  words: readonly Word[],
  eventsById: ReadonlyMap<string, CapturedEvent>,
  placements: readonly Placement[],
  options: TranscriptOptions,
): string[] {
  const isParagraphBreak = (p: number) =>
    p > 0 && p < words.length && words[p].start - words[p - 1].end >= options.paragraphPauseMs;

  const markersAfterWord = new Map<number, string>();
  const blocksAtPosition = new Map<number, string[]>();
  const addBlock = (position: number, block: string) =>
    blocksAtPosition.set(position, [...(blocksAtPosition.get(position) ?? []), block]);

  let currentUrl: string | undefined;
  let previousBoundary = 0;
  for (const slot of buildSlots(placements, eventsById)) {
    const marker = renderMarker(slot.events, options.markerBudget);
    const url = urlLabel(slot.events[0].url);
    if (url !== currentUrl) {
      const position = separatorPosition(slot, previousBoundary, words, (p) =>
        p === 0 || isParagraphBreak(p) || blocksAtPosition.has(p),
      );
      addBlock(position, `— ${escapeMarkdown(url)} —`);
      currentUrl = url;
    }
    if (slot.standalone) addBlock(slot.wordIndex + 1, marker);
    else markersAfterWord.set(slot.wordIndex, marker);
    previousBoundary = slot.wordIndex + 1;
  }

  const spaced = usesLeadingSpaces(words);
  const blocks: string[] = words.length === 0 ? ["_No speech was transcribed._"] : [];
  let paragraph = "";
  const flush = () => {
    const text = paragraph.trim();
    if (text !== "") blocks.push(escapeLineStart(text));
    paragraph = "";
  };
  for (let p = 0; p <= words.length; p++) {
    const extra = blocksAtPosition.get(p);
    if (extra || isParagraphBreak(p)) {
      flush();
      blocks.push(...(extra ?? []));
    }
    if (p < words.length) paragraph += renderWord(words[p], spaced, markersAfterWord.get(p));
  }
  flush();
  return blocks;
}

/**
 * Group placements into slots, in document order.
 * - Inline placements on the same word and page (urlLabel) merge into one bracket (D4.6),
 *   whatever their kind. Events of different pages never share a bracket: a URL separator
 *   has to fit between them.
 * - A standalone event and the burst members sharing its anchor (same page) form one line.
 * - A word holds one inline bracket. When events of another page are anchored to the same
 *   word (e.g. a navigation during the pause after "esto,"), the first page in time keeps the
 *   inline bracket and each later page becomes a line after that word, so its separator can go
 *   right above it. Its placement is unchanged; only the presentation moves.
 * Order: by word; at the same word the inline bracket comes first (it sits inside the text,
 * the lines after it); lines at the same word keep time order.
 */
function buildSlots(
  placements: readonly Placement[],
  eventsById: ReadonlyMap<string, CapturedEvent>,
): Slot[] {
  const kindById = new Map(placements.map((p) => [p.eventId, p.kind]));
  const slots = new Map<string, Slot>();
  for (const placement of placements) {
    const event = eventsById.get(placement.eventId);
    if (!event) continue;
    const standalone =
      placement.kind === "standalone" ||
      (placement.kind === "burst" && kindById.get(placement.sharedWith ?? "") === "standalone");
    const page = urlLabel(event.url);
    const key = standalone
      ? `line:${placement.sharedWith ?? placement.eventId}\u0000${page}`
      : `word:${placement.wordIndex}\u0000${page}`;
    const slot = slots.get(key) ?? { standalone, wordIndex: placement.wordIndex, events: [] };
    slot.events.push(event);
    slots.set(key, slot);
  }
  // Map iteration follows insertion, i.e. time order of each slot's first event.
  const inlineWords = new Set<number>();
  for (const slot of slots.values()) {
    if (slot.standalone) continue;
    if (inlineWords.has(slot.wordIndex)) slot.standalone = true;
    else inlineWords.add(slot.wordIndex);
  }
  // Array.prototype.sort is stable, so equal keys keep insertion (= time) order.
  return [...slots.values()].sort(
    (a, b) => a.wordIndex - b.wordIndex || Number(a.standalone) - Number(b.standalone),
  );
}

/**
 * Where to put the "— /path —" line announcing a new URL before `slot`.
 * A standalone line gets it right above itself. For an inline marker we look back, but never
 * past the previous slot (whose URL is different), for the latest good break:
 * 1. an existing break (start, paragraph pause, or a block already placed there);
 * 2. else the latest sentence end;
 * 3. else just before the anchor word.
 * Why: the separator should split the transcript where the speaker moved on, not mid-phrase.
 */
function separatorPosition(
  slot: Slot,
  previousBoundary: number,
  words: readonly Word[],
  isBreak: (position: number) => boolean,
): number {
  if (slot.standalone) return slot.wordIndex + 1;
  for (let p = slot.wordIndex; p >= previousBoundary; p--) {
    if (isBreak(p)) return p;
  }
  for (let p = slot.wordIndex; p >= Math.max(previousBoundary, 1); p--) {
    if (SENTENCE_END.test(words[p - 1].text.trimEnd())) return p;
  }
  return slot.wordIndex;
}

/** One word token, with its inline marker after the word and before its punctuation. */
export function renderWord(word: Word, spaced: boolean, marker: string | undefined): string {
  const { lead, core, trailing } = splitWord(word.text);
  // Bare-word engines need a space between words, except before a punctuation-only token.
  const space = spaced ? lead : isPunctuationOnly(word.text) ? "" : " ";
  const after = marker ? ` ${marker}` : "";
  return `${space}${escapeMarkdown(core)}${after}${escapeMarkdown(trailing)}`;
}
