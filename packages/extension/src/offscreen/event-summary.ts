import type { CapturedEvent, Gesture } from "@pointcast/core";
import { collapseWhitespace, truncate } from "../lib/text";

/** Longest element part of a summary ("button «Export»"); the gesture is added after it. */
export const MAX_ELEMENT_SUMMARY = 40;
/** The quoted name keeps at least this many characters, even after a long custom-element tag. */
const MIN_NAME = 12;

const GESTURE_LABEL: Record<Gesture, string> = {
  point: "Alt+click",
  click: "click",
  select: "selection",
};

/**
 * The event in one short line for the popup, so the user can see a gesture landed without
 * opening the session files: `button «Export» · Alt+click`, `th «Quantity» · selection`.
 *
 * PRIVACY (D8): built only from the event the recorder keeps, whose ElementInfo and selection
 * were sanitized in the page, never from the DOM. A sensitive element shows its tag and label
 * only: its text is already empty, and describeElement builds a sensitive element's label from
 * its <label> or aria-labelledby, never from its own attributes, which may hold the value.
 */
export function summarizeEvent(event: Pick<CapturedEvent, "gesture" | "element" | "selection">): string {
  const { element } = event;
  const candidates = element.sensitive
    ? [element.label]
    : // For a selection, what was selected says more than its (possibly large) container.
      [event.gesture === "select" ? event.selection?.text : undefined, element.text, element.label];
  const name = candidates.map((value) => collapseWhitespace(value ?? "")).find((value) => value !== "");
  const budget = Math.max(MIN_NAME, MAX_ELEMENT_SUMMARY - element.tag.length - 3);
  const target = name === undefined ? element.tag : `${element.tag} «${truncate(name, budget)}»`;
  return `${target} · ${GESTURE_LABEL[event.gesture]}`;
}
