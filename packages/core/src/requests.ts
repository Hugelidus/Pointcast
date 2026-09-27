import { codeFirstLines, codePointerLines } from "./code-pointer";
import { elementKey, elementText, urlLabel } from "./describe";
import { htmlAddsInformation, htmlSnippet, searchHints, stylesLine } from "./element-hints";
import type { Placement } from "./fuse";
import { codeSpan, escapeLineStart, escapeMarkdown, oneLine, truncate } from "./markdown";
import { findMisheard } from "./misheard";
import { nounTarget, spokenNoun } from "./nouns";
import type { CapturedEvent, ElementInfo, Word } from "./schema";
import { splitSentences, type Sentence } from "./sentences";
import { renderWord } from "./transcript";
import { usesLeadingSpaces } from "./word-text";

/**
 * The "requests" format: the spec as a numbered list of change requests, one per spoken
 * sentence, each with the elements pointed at while saying it and what the agent needs to
 * find them in the code. No times, ids or engine data: the agent acts on the request, it does
 * not audit the recording (the classic format still does that).
 */

/**
 * How an element with code information (`renderedBy`, `resolved`) is laid out; elements without
 * it always get the DOM-first layout.
 * - code-first: its code locations by role (used at, defined in, text at, data at, within) with
 *   their source lines, then what it is on screen.
 * - dom-first: the element as seen on screen, with the code pointer as one `code:` line and the
 *   `text at:`/`data at:` lines, no source lines (the layout Stage 0 evaluated).
 */
export type RequestsLayout = "code-first" | "dom-first";

export interface RequestsOptions {
  /** A pause this long ends a sentence when the engine did not punctuate. */
  paragraphPauseMs: number;
  /** Maximum length of a quoted selection. */
  selectionBudget: number;
  layout: RequestsLayout;
}

/** Element text in a descriptor: a label to recognize it, not the full content. */
const DESCRIPTOR_TEXT_BUDGET = 60;
/** Inline HTML snippet: one short line, only when it adds information. */
const SNIPPET_BUDGET = 160;

const PREAMBLE = [
  "Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.",
  "Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.",
];

/** Added to the preamble when at least one element is laid out code-first. */
const CODE_FIRST_PREAMBLE =
  'Where the code is known, an element starts with it: prefer its "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.';

interface Pointed {
  event: CapturedEvent;
  placement: Placement;
}

/** One request: a sentence and the elements pointed at during it, or a pointing-only gap. */
interface Unit {
  sentence?: Sentence;
  pointed: Pointed[];
}

export function renderRequests(
  events: readonly CapturedEvent[],
  words: readonly Word[],
  placements: readonly Placement[],
  options: RequestsOptions,
): string[] {
  const units = buildUnits(events, words, placements, options.paragraphPauseMs);
  const codeFirst = options.layout === "code-first" && events.some((event) => codeFirstLines(event.element).length > 0);
  const blocks = ["# UI change requests", [...PREAMBLE, ...(codeFirst ? [CODE_FIRST_PREAMBLE] : [])].join("\n")];
  if (units.length === 0) return [...blocks, "_Nothing was said or pointed at._"];

  const spaced = usesLeadingSpaces(words);
  // Element key -> number of the request that described it in full.
  const describedIn = new Map<string, number>();
  units.forEach((unit, index) => {
    const number = index + 1;
    const groups = groupByElement(unit.pointed);
    const letters = new Map([...groups.keys()].map((key, i) => [key, letter(i)]));
    blocks.push(`## Request ${number}`);
    blocks.push(quote(unit, words, spaced, letters));
    const lines: string[] = [];
    for (const [key, group] of groups) {
      lines.push(...elementLines(group, letters.get(key) ?? "?", unit, words, describedIn.get(key), options));
      if (!describedIn.has(key)) describedIn.set(key, number);
    }
    if (lines.length > 0) blocks.push(lines.join("\n"));
  });

  const pages = [...new Set(events.map((event) => event.url))];
  if (pages.length > 0) {
    blocks.push("## Appendix", `Pages by full URL: ${pages.map((url) => codeSpan(url)).join(" · ")}`);
  }
  return blocks;
}

/**
 * Sentences in order, each with the events anchored inside it. Events on a line of their own
 * (standalone, pointed during a long silence or with no speech) form a request of their own
 * after the sentence they follow: they belong to no sentence, and gluing them to a neighbour
 * would put words in the user's mouth.
 */
function buildUnits(
  events: readonly CapturedEvent[],
  words: readonly Word[],
  placements: readonly Placement[],
  pauseMs: number,
): Unit[] {
  const sentences = splitSentences(words, pauseMs);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const kindById = new Map(placements.map((p) => [p.eventId, p.kind]));
  const sentenceOf = (wordIndex: number) =>
    sentences.findIndex((s) => wordIndex >= s.from && wordIndex < s.to);

  // Index s holds sentence s; the gap after sentence s is at s + 1 of `gaps` (0 = before speech).
  const inSentence: Pointed[][] = sentences.map(() => []);
  const gaps: Pointed[][] = [[], ...sentences.map(() => [])];
  for (const placement of placements) {
    const event = eventsById.get(placement.eventId);
    if (!event) continue;
    const standalone =
      placement.kind === "standalone" ||
      (placement.kind === "burst" && kindById.get(placement.sharedWith ?? "") === "standalone");
    const sentence = placement.wordIndex < 0 ? -1 : sentenceOf(placement.wordIndex);
    if (standalone || sentence < 0) gaps[sentence + 1].push({ event, placement });
    else inSentence[sentence].push({ event, placement });
  }

  const units: Unit[] = [];
  if (gaps[0].length > 0) units.push({ pointed: gaps[0] });
  sentences.forEach((sentence, s) => {
    units.push({ sentence, pointed: inSentence[s] });
    if (gaps[s + 1].length > 0) units.push({ pointed: gaps[s + 1] });
  });
  return units;
}

/** Events grouped by element (same element twice = one entry), in order of first pointing. */
function groupByElement(pointed: readonly Pointed[]): Map<string, Pointed[]> {
  const groups = new Map<string, Pointed[]>();
  for (const item of pointed) {
    const key = elementKey(item.event);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/** a..z, then 27, 28…: sessions rarely point at more than a handful of elements per sentence. */
function letter(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : String(index + 1);
}

/** The sentence as a blockquote with "[a]" after each word the user pointed on. */
function quote(
  unit: Unit,
  words: readonly Word[],
  spaced: boolean,
  letters: ReadonlyMap<string, string>,
): string {
  if (!unit.sentence) return "_Pointed at without speaking._";
  const tagsByWord = new Map<number, string[]>();
  for (const { event, placement } of unit.pointed) {
    const tag = letters.get(elementKey(event)) ?? "?";
    const tags = tagsByWord.get(placement.wordIndex) ?? [];
    if (!tags.includes(tag)) tags.push(tag);
    tagsByWord.set(placement.wordIndex, tags);
  }
  let text = "";
  for (let k = unit.sentence.from; k < unit.sentence.to; k++) {
    const tags = tagsByWord.get(k);
    text += renderWord(words[k], spaced, tags ? `[${tags.join(", ")}]` : undefined);
  }
  return `> ${escapeLineStart(oneLine(text))}`;
}

function elementLines(
  group: readonly Pointed[],
  tag: string,
  unit: Unit,
  words: readonly Word[],
  describedIn: number | undefined,
  options: RequestsOptions,
): string[] {
  const { event, placement } = group[0];
  const element = event.element;
  const page = codeSpan(urlLabel(event.url));
  const notes = gestureNotes(group.map((item) => item.event), options);
  const onScreen = `${descriptor(element)}${nextTo(element)}${within(element)}${notes} on ${page}`;
  // Code-first only where there is code to lead with, and only where the element is described in
  // full: a repeat is a one-line back-reference in both layouts.
  const code = options.layout === "code-first" && describedIn === undefined ? codeFirstLines(element) : [];

  const head = code.length > 0 ? `- [${tag}] ${label(element)} → code:` : `- [${tag}] ${onScreen}`;
  const details: string[] = [];
  if (code.length > 0) details.push(...code, `on screen: ${onScreen}`, ...identification(event, false));
  else if (describedIn === undefined) details.push(...identification(event, true));
  if (unit.sentence) {
    const { from, to } = unit.sentence;
    const noun = spokenNoun(words, placement.wordIndex, from, to);
    const target = noun && nounTarget(noun.kind, element.path);
    if (noun && target) details.push(`said «${escapeMarkdown(noun.word)}»: ${target}`);
    const misheard = findMisheard(words, placement.wordIndex, from, to, [
      element.text,
      element.label ?? "",
    ]);
    if (misheard) {
      details.push(
        `heard «${escapeMarkdown(misheard.heard)}», probably «${escapeMarkdown(misheard.meant)}»`,
      );
    }
  }

  const repeat = describedIn === undefined ? "" : ` (same element as in request ${describedIn})`;
  return [head + repeat, ...details.map((line) => `  - ${line}`)];
}

/** «Export» for the code-first head, or the tag when there is neither text nor label. */
function label(element: ElementInfo): string {
  const text = oneLine(elementText(element));
  return text === "" ? escapeMarkdown(element.tag) : `«${escapeMarkdown(truncate(text, DESCRIPTOR_TEXT_BUDGET))}»`;
}

/** `button «Export»`, or just the tag when there is neither text nor label. */
function descriptor(element: ElementInfo): string {
  const text = oneLine(elementText(element));
  const tag = escapeMarkdown(element.tag);
  return text === "" ? tag : `${tag} «${escapeMarkdown(truncate(text, DESCRIPTOR_TEXT_BUDGET))}»`;
}

/**
 * " next to «Messages»": the item a short value belongs to (ElementInfo.itemLabel), which says
 * which «3» of the page it is.
 */
function nextTo(element: ElementInfo): string {
  const item = oneLine(element.itemLabel ?? "");
  return item === "" ? "" : ` next to «${escapeMarkdown(truncate(item, DESCRIPTOR_TEXT_BUDGET))}»`;
}

/**
 * " in «$45,385 · Sales this week»": the card or section the element is in (ElementInfo.context).
 * Next to the element, because it is what tells apart two instances of a shared component.
 */
function within(element: ElementInfo): string {
  const context = oneLine(element.context ?? "");
  return context === "" ? "" : ` in «${escapeMarkdown(truncate(context, DESCRIPTOR_TEXT_BUDGET))}»`;
}

/**
 * " (selected «…»)" for a selection of part of the element, " (selected)" for all of it,
 * " (plain click)" when every event was a plain click: those may just be the user using the
 * app (navigating) rather than pointing (D7), so the agent should weigh them against the words.
 */
function gestureNotes(events: readonly CapturedEvent[], options: RequestsOptions): string {
  const selection = events.find((e) => e.gesture === "select" && e.selection)?.selection;
  if (selection) {
    const selected = oneLine(selection.text);
    if (selected === "" || selected === oneLine(events[0].element.text)) return " (selected)";
    return ` (selected «${escapeMarkdown(truncate(selected, options.selectionBudget))}»)`;
  }
  return events.every((e) => e.gesture === "click") ? " (plain click)" : "";
}

/**
 * How to find the element: grep keys, location, look, and HTML only when it adds something.
 * `codePointer`: the DOM-first `code:`/`text at:` lines (code-first puts its own lines first).
 */
function identification(event: CapturedEvent, codePointer: boolean): string[] {
  const element = event.element;
  const lines: string[] = [];
  const hints = searchHints(element);
  if (hints.length > 0) lines.push(`find: ${hints.join(" · ")}`);
  // After find:, where Stage 0 placed them; nothing for sessions without renderedBy/resolved.
  if (codePointer) lines.push(...codePointerLines(element));
  lines.push(`in: ${codeSpan(element.path)}`);
  // A selector is the last resort (it is often nth-of-type soup): only when nothing above names it.
  if (hints.length === 0 && elementText(element) === "") {
    lines.push(`selector: ${codeSpan(element.selector)}`);
  }
  // Present only when the selection's common container was too large to describe it (D5).
  const { start, end } = event.selection ?? {};
  if (start) lines.push(`selection starts in ${descriptor(start)} ${codeSpan(start.path)}`);
  if (end) lines.push(`selection ends in ${descriptor(end)} ${codeSpan(end.path)}`);
  const styles = stylesLine(element.styles);
  if (styles) lines.push(`styles: ${styles}`);
  if (htmlAddsInformation(element)) lines.push(`html: ${codeSpan(htmlSnippet(element.html, SNIPPET_BUDGET))}`);
  // Past tense, about pointcast itself (D8): never phrased as an instruction.
  if (element.sensitive) lines.push("privacy: pointcast did not record this field's value or text");
  return lines;
}
