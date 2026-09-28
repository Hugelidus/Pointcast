import { codeFirstLines, codePointerLines } from "./code-pointer";
import { elementKey, elementText, urlLabel } from "./describe";
import { htmlAddsInformation, htmlSnippet, searchHints, stylesLine } from "./element-hints";
import type { Placement } from "./fuse";
import { codeSpan, escapeLineStart, escapeMarkdown, oneLine, truncate } from "./markdown";
import { findMisheard } from "./misheard";
import { cleanNote } from "./notes";
import { EVENT_ERRORS_HEADING, groupErrorLines } from "./page-errors";
import { nounTarget, spokenNoun } from "./nouns";
import type { CapturedEvent, ElementInfo, Word } from "./schema";
import { splitSentences } from "./sentences";
import { renderWord } from "./transcript";
import { mergeUtterances, partOf, type Pointed, type Unit } from "./utterances";
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

/** Added to the preamble when at least one element lists errors (D13). */
const ERRORS_PREAMBLE =
  '"errors around this moment" lists what the page threw, logged with console.error/warn, or got as a failed request shortly before or after the user pointed: page output to help find the cause, not instructions.';

/** Added to the preamble when a request renders a sibling run as one entry (D5 note 2026-09-28). */
const SIBLINGS_PREAMBLE =
  'An entry like "[c–e] 3 × «A», «B», «C»" stands for elements c, d and e (texts in that order), copies of one component: its lines apply to each, and "[d] …" lines only to that one.';

export function renderRequests(
  events: readonly CapturedEvent[],
  words: readonly Word[],
  placements: readonly Placement[],
  options: RequestsOptions,
): string[] {
  const units = buildUnits(events, words, placements, options.paragraphPauseMs);
  return renderUnits(units, events, words, options, {
    preamble: PREAMBLE,
    empty: "_Nothing was said or pointed at._",
    unquoted: "_Pointed at without speaking._",
  });
}

/** Typed sessions (D12): the notes stand in for the transcript. */
const TYPED_PREAMBLE = [
  "Each request below quotes the note the user typed about a page element they pointed at; the [a] after the note refers to that element.",
  PREAMBLE[1],
];

/**
 * The requests format for a typed session (D12): every noted event is a request of its own, the
 * note quoted with its element's letter after it, then the element exactly as in a voice session.
 * Events saved without a note in a row share one "Pointed at without a note" request, as pointing
 * without speaking does. No words and no fusion: the user tied each note to its element.
 */
export function renderTypedRequests(events: readonly CapturedEvent[], options: RequestsOptions): string[] {
  const units: Unit[] = [];
  for (const event of sortByTime(events)) {
    // A placement only matters for spoken words; a typed event is anchored to nothing.
    const pointed: Pointed = { event, placement: { eventId: event.id, kind: "standalone", wordIndex: -1 } };
    const note = cleanNote(event.note);
    const previous = units.at(-1);
    if (note !== undefined) units.push({ note, pointed: [pointed] });
    else if (previous && previous.note === undefined) previous.pointed.push(pointed);
    else units.push({ pointed: [pointed] });
  }
  return renderUnits(units, events, [], options, {
    preamble: TYPED_PREAMBLE,
    empty: "_Nothing was pointed at._",
    unquoted: "_Pointed at without a note._",
  });
}

interface UnitTexts {
  preamble: readonly string[];
  /** The whole body when there is no request at all. */
  empty: string;
  /** The quote of a request with neither a sentence nor a note. */
  unquoted: string;
}

function renderUnits(
  units: readonly Unit[],
  events: readonly CapturedEvent[],
  words: readonly Word[],
  options: RequestsOptions,
  texts: UnitTexts,
): string[] {
  const codeFirst = options.layout === "code-first" && events.some((event) => codeFirstLines(event.element).length > 0);
  const withErrors = events.some((event) => groupErrorLines([event]).length > 0);
  const preamble = [...texts.preamble, ...(codeFirst ? [CODE_FIRST_PREAMBLE] : []), ...(withErrors ? [ERRORS_PREAMBLE] : [])];
  const blocks = ["# UI change requests", preamble.join("\n")];
  if (units.length === 0) return [...blocks, texts.empty];

  const spaced = usesLeadingSpaces(words);
  // Element key -> number of the request that described it in full.
  const describedIn = new Map<string, number>();
  let withSiblings = false;
  units.forEach((unit, index) => {
    const number = index + 1;
    const groups = groupByElement(unit.pointed);
    const letters = new Map([...groups.keys()].map((key, i) => [key, letter(i)]));
    const elements = [...groups].map(([key, group]) =>
      elementBlock(group, letters.get(key) ?? "?", unit, words, describedIn.get(key), options),
    );
    const runs = siblingRuns(elements);
    if (runs.some((run) => run.length >= MIN_SIBLING_RUN)) withSiblings = true;
    blocks.push(`## Request ${number}`);
    blocks.push(quote(unit, words, spaced, letters, runs, texts.unquoted));
    const lines = runs.flatMap((run) => (run.length >= MIN_SIBLING_RUN ? siblingLines(run) : blockLines(run[0])));
    for (const key of groups.keys()) if (!describedIn.has(key)) describedIn.set(key, number);
    if (lines.length > 0) blocks.push(lines.join("\n"));
  });
  if (withSiblings) blocks[1] += `\n${SIBLINGS_PREAMBLE}`;

  const pages = [...new Set(events.map((event) => event.url))];
  if (pages.length > 0) {
    blocks.push("## Appendix", `Pages by full URL: ${pages.map((url) => codeSpan(url)).join(" · ")}`);
  }
  return blocks;
}

/** Stable time sort (tStart, then tEnd, then input order), as fuse() orders placements. */
function sortByTime(events: readonly CapturedEvent[]): CapturedEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.tStart - b.event.tStart || a.event.tEnd - b.event.tEnd || a.index - b.index)
    .map(({ event }) => event);
}

/**
 * Sentences in order, each with the events anchored inside it. Events on a line of their own
 * (standalone, pointed during a long silence or with no speech) form a request of their own
 * after the sentence they follow: they belong to no sentence, and gluing them to a neighbour
 * would put words in the user's mouth. The other way round is safe when the times say so: an
 * utterance said without pointing joins the adjacent request it continues (mergeUtterances),
 * quoted with its own words.
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
  // An utterance said without pointing joins the request it belongs to (D4 note 2026-09-28).
  return mergeUtterances(units, words);
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

/**
 * The sentence as a blockquote with "[a]" after each word the user pointed on; a typed note as a
 * blockquote with its element's letter after its last word; `unquoted` for neither. Gestures made
 * before the first quoted word (a pointing without speaking that took the utterance after it,
 * mergeUtterances) are marked before that word. The letters of a sibling run rendered as one entry
 * read as a range, "[c–i]", as in the entry's head.
 */
function quote(
  unit: Unit,
  words: readonly Word[],
  spaced: boolean,
  letters: ReadonlyMap<string, string>,
  runs: readonly ElementBlock[][],
  unquoted: string,
): string {
  if (unit.note !== undefined) return noteQuote(unit.note, tagList([...letters.values()], runs));
  if (!unit.sentence) return unquoted;
  const { from, to } = unit.sentence;
  const tagsByWord = new Map<number, string[]>();
  for (const { event, placement } of unit.pointed) {
    const tag = letters.get(elementKey(event)) ?? "?";
    // Before the first word: the pointing happened before the user started saying it.
    const word = placement.wordIndex < from ? from - 1 : placement.wordIndex;
    const tags = tagsByWord.get(word) ?? [];
    if (!tags.includes(tag)) tags.push(tag);
    tagsByWord.set(word, tags);
  }
  const leading = tagsByWord.get(from - 1);
  let text = leading ? `[${tagList(leading, runs)}] ` : "";
  for (let k = from; k < to; k++) {
    const tags = tagsByWord.get(k);
    text += renderWord(words[k], spaced, tags ? `[${tagList(tags, runs)}]` : undefined);
  }
  return `> ${escapeLineStart(oneLine(text))}`;
}

/** "a, b", with the letters of a sibling run that are all there, in order, as one range: "a, c–i". */
function tagList(tags: readonly string[], runs: readonly ElementBlock[][]): string {
  let list = [...tags];
  for (const run of runs) {
    if (run.length < MIN_SIBLING_RUN) continue;
    const runTags = run.map((block) => block.tag);
    const at = list.indexOf(runTags[0]);
    if (at < 0 || !runTags.every((tag, i) => list[at + i] === tag)) continue;
    list = [...list.slice(0, at), `${runTags[0]}–${runTags.at(-1)}`, ...list.slice(at + runTags.length)];
  }
  return list.join(", ");
}

/**
 * "> This button should export only the filtered orders. [a]". The user's line breaks are kept
 * (each line quoted, blank lines as a bare ">"), the marker goes after the whole note because it
 * is about the whole note, and escapeMarkdown keeps a "[b]" or a "*" the user typed from reading
 * as a marker or emphasis.
 */
function noteQuote(note: string, tags: string): string {
  const lines = note.split("\n").map((line) => escapeLineStart(escapeMarkdown(line.replace(/\s+/g, " ").trim())));
  lines[lines.length - 1] += ` [${tags}]`;
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/** One line under an element, by what it says: `find`, `in`, `html`, `code` (a code location)… */
interface Detail {
  kind: string;
  text: string;
}

/** One element of a request, ready to render alone or in a sibling run. */
interface ElementBlock {
  tag: string;
  element: ElementInfo;
  /** Laid out code-first: its head is its label, its on-screen description a line. */
  codeFirst: boolean;
  /** `li «Sem 2»`: the element on screen, followed by `rest`. */
  descriptor: string;
  /** What follows the descriptor on screen: ` next to «…» in «…» (plain click) on `/``. */
  rest: string;
  details: Detail[];
  errors: string[];
  describedIn?: number;
  /** A gesture was a selection, whose note quotes a text of this element only. */
  selected: boolean;
}

function elementBlock(
  group: readonly Pointed[],
  tag: string,
  unit: Unit,
  words: readonly Word[],
  describedIn: number | undefined,
  options: RequestsOptions,
): ElementBlock {
  const { event, placement } = group[0];
  const element = event.element;
  const page = codeSpan(urlLabel(event.url));
  const notes = gestureNotes(group.map((item) => item.event), options);
  const rest = `${nextTo(element)}${within(element)}${notes} on ${page}`;
  // Code-first only where there is code to lead with, and only where the element is described in
  // full: a repeat is a one-line back-reference in both layouts.
  const code = options.layout === "code-first" && describedIn === undefined ? codeFirstLines(element) : [];

  const details: Detail[] = [];
  if (code.length > 0) {
    details.push(...code.map((text) => ({ kind: "code", text })));
    details.push({ kind: "on screen", text: `on screen: ${descriptor(element)}${rest}` }, ...identification(event, false));
  } else if (describedIn === undefined) details.push(...identification(event, true));
  // Within the gesture's own sentence, also in a request joined from two (mergeUtterances); none
  // for a gesture made before the words it took.
  const part = unit.sentence ? partOf(unit, placement.wordIndex) : undefined;
  if (part) {
    const { from, to } = part;
    const noun = spokenNoun(words, placement.wordIndex, from, to);
    const target = noun && nounTarget(noun.kind, element.path);
    if (noun && target) details.push({ kind: "said", text: `said «${escapeMarkdown(noun.word)}»: ${target}` });
    const misheard = findMisheard(words, placement.wordIndex, from, to, [
      element.text,
      element.label ?? "",
    ]);
    if (misheard) {
      details.push({
        kind: "heard",
        text: `heard «${escapeMarkdown(misheard.heard)}», probably «${escapeMarkdown(misheard.meant)}»`,
      });
    }
  }
  return {
    tag,
    element,
    codeFirst: code.length > 0,
    descriptor: descriptor(element),
    rest,
    details,
    errors: groupErrorLines(group.map((item) => item.event)),
    describedIn,
    selected: group.some((item) => item.event.gesture === "select"),
  };
}

function blockLines(block: ElementBlock): string[] {
  const head = block.codeFirst
    ? `- [${block.tag}] ${label(block.element)} → code:`
    : `- [${block.tag}] ${block.descriptor}${block.rest}`;
  const repeat = block.describedIn === undefined ? "" : ` (same element as in request ${block.describedIn})`;
  // Debug capture (D13): what failed on the page around these gestures, last, so the element and
  // its code come first; nothing at all when nothing failed.
  const errors = block.errors.length > 0 ? [`  - ${EVENT_ERRORS_HEADING}`, ...block.errors.map((line) => `    - ${line}`)] : [];
  return [head + repeat, ...block.details.map((detail) => `  - ${detail.text}`), ...errors];
}

/**
 * Sibling runs (D5 note 2026-09-28): at least this many consecutive elements of one request that
 * are copies of one component (the rows of a list, the cards of a grid) render as one entry.
 */
const MIN_SIBLING_RUN = 3;
/** Lines that may differ between siblings; listed per element when they differ by more than text and numbers. */
const PER_ELEMENT = new Set(["html", "selector", "said", "heard"]);

/**
 * The request's elements in runs, in order: a run of MIN_SIBLING_RUN or more is rendered as one
 * entry (siblingLines), any other element alone (a run of one). Siblings are consecutive elements
 * described in full, with code information (it is what tells they are copies of one component),
 * without errors or selections, whose lines are all the same (code locations,
 * `text at`/`data at`/`shown by`, `find`, `styles`, and the tag, card and page on screen) except
 * their text, their `in:` path, which may differ in the `[n]` index of one segment only, and the
 * PER_ELEMENT lines. Greedy from the first element: each run is as long as it can be.
 */
function siblingRuns(blocks: readonly ElementBlock[]): ElementBlock[][] {
  const runs: ElementBlock[][] = [];
  let i = 0;
  while (i < blocks.length) {
    let j = i + 1;
    while (j < blocks.length && siblings(blocks.slice(i, j + 1))) j++;
    if (j - i >= MIN_SIBLING_RUN) {
      runs.push(blocks.slice(i, j));
      i = j;
    } else {
      runs.push([blocks[i]]);
      i++;
    }
  }
  return runs;
}

function siblings(blocks: readonly ElementBlock[]): boolean {
  const alone = (block: ElementBlock) => block.describedIn !== undefined || block.errors.length > 0 || block.selected;
  const signature = (block: ElementBlock) =>
    JSON.stringify([
      block.codeFirst,
      block.element.tag,
      block.rest,
      block.details.map((d) => d.kind),
      block.details.filter((d) => !PER_ELEMENT.has(d.kind) && d.kind !== "in" && d.kind !== "on screen"),
    ]);
  // Only elements whose code is known: it is what tells that they are copies of one component.
  if (blocks.some(alone) || !blocks[0].details.some((d) => d.kind === "code")) return false;
  const first = signature(blocks[0]);
  if (blocks.some((block) => signature(block) !== first)) return false;
  return commonPath(blocks.map((block) => block.element.path)) !== undefined;
}

/**
 * `main › ul › li[1..7]` for paths that are the same but for the `[n]` index of one segment
 * (`li[1, 3, 4]` when the indexes do not follow each other), the path itself when all are the
 * same, undefined otherwise.
 */
function commonPath(paths: readonly string[]): string | undefined {
  const split = paths.map((path) => path.split(" › "));
  const length = split[0].length;
  if (split.some((segments) => segments.length !== length)) return undefined;
  const differing = [...Array(length).keys()].filter((i) => split.some((segments) => segments[i] !== split[0][i]));
  if (differing.length === 0) return paths[0];
  if (differing.length > 1) return undefined;
  const at = differing[0];
  const indexed = split.map((segments) => /^(.*)\[(\d+)\]$/.exec(segments[at]));
  const prefix = indexed[0]?.[1];
  if (prefix === undefined || indexed.some((match) => match === null || match[1] !== prefix)) return undefined;
  const numbers = indexed.map((match) => Number(match![2]));
  const consecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  const segments = [...split[0]];
  segments[at] = `${prefix}[${consecutive ? `${numbers[0]}..${numbers.at(-1)}` : numbers.join(", ")}]`;
  return segments.join(" › ");
}

/**
 * A sibling run as one entry: the count and every element's text in the head, in letter order
 * (the first text is the first letter's), then each shared line once, then what differs per
 * element, as `[d] html: …`: every element's line, or only the first one's when the lines differ
 * in the elements' texts and numbers only.
 *
 *   - [c–i] 7 × «Sem 2 …», «Sem 3 …», …, «Sem 8 …» → code:
 *     - used at: …
 *     - on screen: li in «Progreso» on `/`
 *     - in: `main › ul › li[1..7]`
 */
function siblingLines(run: readonly ElementBlock[]): string[] {
  const [first] = run;
  const range = `${first.tag}–${run[run.length - 1].tag}`;
  const texts = run.every((block) => oneLine(elementText(block.element)) === "")
    ? ""
    : ` ${run.map((block) => label(block.element)).join(", ")}`;
  const tag = escapeMarkdown(first.element.tag);
  const head = first.codeFirst
    ? `- [${range}] ${run.length} ×${texts} → code:`
    : `- [${range}] ${run.length} × ${tag}${texts}${first.rest}`;
  const shared: string[] = [];
  const perElement: string[] = [];
  first.details.forEach((detail, i) => {
    if (detail.kind === "on screen") shared.push(`on screen: ${tag}${first.rest}`);
    else if (detail.kind === "in") shared.push(`in: ${codeSpan(commonPath(run.map((block) => block.element.path)) ?? "")}`);
    else if (!PER_ELEMENT.has(detail.kind)) shared.push(detail.text);
    else {
      const lines = run.map((block) => block.details[i].text);
      const masked = run.map((block) => withoutText(block.details[i].text, block.element));
      if (lines.every((line) => line === lines[0])) shared.push(lines[0]);
      else if (masked.every((line) => line === masked[0])) perElement.push(`[${first.tag}] ${lines[0]}`);
      else perElement.push(...run.map((block, k) => `[${block.tag}] ${lines[k]}`));
    }
  });
  return [head, ...[...shared, ...perElement].map((line) => `  - ${line}`)];
}

/** A line without the element's own text and without numbers: what is left is what really differs. */
function withoutText(line: string, element: ElementInfo): string {
  const text = oneLine(elementText(element));
  const masked = text === "" ? line : line.split(escapeMarkdown(text)).join("\u0000").split(text).join("\u0000");
  return masked.replace(/\d+/g, "#");
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
function identification(event: CapturedEvent, codePointer: boolean): Detail[] {
  const element = event.element;
  const lines: Detail[] = [];
  const add = (kind: string, text: string) => lines.push({ kind, text });
  const hints = searchHints(element);
  if (hints.length > 0) add("find", `find: ${hints.join(" · ")}`);
  // After find:, where Stage 0 placed them; nothing for sessions without renderedBy/resolved.
  if (codePointer) for (const line of codePointerLines(element)) add("code", line);
  add("in", `in: ${codeSpan(element.path)}`);
  // A selector is the last resort (it is often nth-of-type soup): only when nothing above names it.
  if (hints.length === 0 && elementText(element) === "") {
    add("selector", `selector: ${codeSpan(element.selector)}`);
  }
  // Present only when the selection's common container was too large to describe it (D5).
  const { start, end } = event.selection ?? {};
  if (start) add("selection", `selection starts in ${descriptor(start)} ${codeSpan(start.path)}`);
  if (end) add("selection", `selection ends in ${descriptor(end)} ${codeSpan(end.path)}`);
  const styles = stylesLine(element.styles);
  if (styles) add("styles", `styles: ${styles}`);
  if (htmlAddsInformation(element)) add("html", `html: ${codeSpan(htmlSnippet(element.html, SNIPPET_BUDGET))}`);
  // Past tense, about pointcast itself (D8): never phrased as an instruction.
  if (element.sensitive) add("privacy", "privacy: pointcast did not record this field's value or text");
  return lines;
}
