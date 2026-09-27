import { codePointerLines } from "./code-pointer";
import { elementKey, elementText, eventText, formatClock, fullSource } from "./describe";
import type { Placement } from "./fuse";
import { trimHtml } from "./html-trim";
import { codeSpan, escapeMarkdown, fencedBlock, inlineText, oneLine, truncate } from "./markdown";
import type { CapturedEvent, ElementInfo, Word } from "./schema";
import { splitWord } from "./word-text";

export interface AppendixOptions {
  /** Maximum length of each element's HTML (D5: 300), trimmed structurally. */
  htmlBudget: number;
  /** Maximum length of each selected text. */
  selectionBudget: number;
}

/** Heading text budget: the heading is a label; the full text is in the HTML below it. */
const HEADING_TEXT_BUDGET = 60;

/**
 * Appendix blocks: one entry per unique element (D5), in order of first appearance, listing
 * every event that pointed at it. `events` must be in time order.
 */
export function renderAppendix(
  events: readonly CapturedEvent[],
  placements: readonly Placement[],
  words: readonly Word[],
  options: AppendixOptions,
): string[] {
  if (events.length === 0) return ["No elements were pointed at."];

  const placementById = new Map(placements.map((p) => [p.eventId, p]));
  const groups = new Map<string, CapturedEvent[]>();
  for (const event of events) {
    const key = elementKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const blocks: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const element = first.element;
    const ids = group.map((event) => event.id).join(", ");
    blocks.push(`### ${ids} · ${describeElement(element, HEADING_TEXT_BUDGET)}`);

    const lines = group.flatMap((event) =>
      eventLines(event, placementById.get(event.id), words, options),
    );
    lines.push(`- path: ${codeSpan(element.path)}`);
    lines.push(
      `- selector: ${codeSpan(element.selector)} (${element.selectorUnique ? "unique" : "not unique"})`,
    );
    if (element.source) {
      const distance = element.source.distance;
      const ancestor = distance > 0 ? ` (ancestor +${distance})` : "";
      lines.push(`- source: ${codeSpan(fullSource(element.source))}${ancestor}`);
    }
    lines.push(...codePointerLines(element).map((line) => `- ${line}`));
    lines.push(`- url: ${codeSpan(first.url)}`);
    if (element.label) lines.push(`- label: «${inlineText(element.label)}»`);
    if (element.hint) lines.push(`- hint: «${inlineText(element.hint)}»`);
    if (element.context) lines.push(`- context: «${inlineText(element.context)}»`);
    if (element.itemLabel) lines.push(`- next to: «${inlineText(element.itemLabel)}»`);
    // Third person, past tense, about pointcast's own capture behaviour (D8) — never phrased
    // as an instruction, so a reader cannot mistake it for a request to mask this field.
    if (element.sensitive) {
      lines.push("- privacy: pointcast did not record this field's value or text");
    }
    blocks.push(lines.join("\n"));

    if (element.html !== "") {
      blocks.push(fencedBlock(trimHtml(element.html, options.htmlBudget), "html"));
    }
  }
  return blocks;
}

/** "th «Quantity»", or just "th" when there is neither text nor label. */
function describeElement(element: ElementInfo, textBudget: number): string {
  const text = oneLine(elementText(element));
  return text === "" ? element.tag : `${element.tag} «${escapeMarkdown(truncate(text, textBudget))}»`;
}

/** "- e1: select at 00:04, deictic «esto»; selected «Quantity»" plus selection bounds. */
function eventLines(
  event: CapturedEvent,
  placement: Placement | undefined,
  words: readonly Word[],
  options: AppendixOptions,
): string[] {
  let line = `- ${event.id}: ${event.gesture} at ${formatClock(event.tStart)}, ${anchoring(placement, words)}`;
  const selection = event.selection;
  if (selection && selection.text !== "") {
    line += `; selected «${escapeMarkdown(truncate(oneLine(eventText(event)), options.selectionBudget))}»`;
  }
  const lines = [line];
  // Present only when the common container was too large to be useful (D5).
  if (selection?.start) {
    lines.push(`- ${event.id} selection starts in: ${describeBound(selection.start)}`);
  }
  if (selection?.end) {
    lines.push(`- ${event.id} selection ends in: ${describeBound(selection.end)}`);
  }
  return lines;
}

function describeBound(element: ElementInfo): string {
  return `${describeElement(element, HEADING_TEXT_BUDGET)} ${codeSpan(element.selector)}`;
}

/** Human-readable anchoring, so a reader can audit fusion decisions. */
function anchoring(placement: Placement | undefined, words: readonly Word[]): string {
  if (!placement) return "not placed";
  const word = () => `«${inlineText(splitWord(words[placement.wordIndex].text).core)}»`;
  switch (placement.kind) {
    case "deictic":
      return `deictic ${word()}`;
    case "pause":
      return `pause after ${word()}`;
    case "word":
      return `after ${word()}`;
    case "burst":
      return `burst with ${placement.sharedWith ?? "?"}`;
    case "standalone":
      return "standalone (no speech nearby)";
  }
}
