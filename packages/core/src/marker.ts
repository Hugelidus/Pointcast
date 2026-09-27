import { elementKey, eventText, formatClock, shortSource } from "./describe";
import { escapeMarkdown, oneLine, truncate } from "./markdown";
import type { CapturedEvent } from "./schema";

/**
 * Shortest the quoted text may get when the budget is tight: below this the marker stops
 * being greppable, and a slightly longer marker is the better trade.
 */
const MIN_TEXT = 12;

/**
 * Inline marker for one anchor: "*[00:04 · th «Quantity» · Toolbar.tsx:12 · e1]*".
 * Events must be in time order.
 * Several elements on one anchor merge into one bracket separated by "; ", and the same
 * element pointed at twice keeps one descriptor with its first id and a repeat count
 * ("th «Quantity» · e1 ×4") instead of listing every id — that forced cross-referencing
 * and wasted tokens for no benefit inline; the Appendix heading still names every id
 * ("### e1, e4, ... · th «Quantity»") so any of them can be looked up there.
 * The clock is normally the first event's time; when this marker's events (across all its
 * elements) span more than 1 s, it becomes a range from the earliest start to the latest end
 * ("00:26–00:29"), so a marker never hides that its events were seconds apart.
 * The quoted text is trimmed so that each element's part, rendered alone, stays within
 * `budget` characters (D5: ~80); a merged bracket may be longer, one part per element.
 */
export function renderMarker(events: readonly CapturedEvent[], budget: number): string {
  const clock = formatClockSpan(events);
  const groups = new Map<string, CapturedEvent[]>();
  for (const event of events) {
    const key = elementKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const parts = [...groups.values()].map((group) => markerPart(group, clock, budget));
  return `*[${clock} · ${parts.join("; ")}]*`;
}

/** "mm:ss", or "mm:ss–mm:ss" when the earliest start and the latest end are over 1 s apart. */
function formatClockSpan(events: readonly CapturedEvent[]): string {
  let min = events[0].tStart;
  let max = events[0].tEnd;
  for (const event of events) {
    min = Math.min(min, event.tStart);
    max = Math.max(max, event.tEnd);
  }
  return max - min > 1000 ? `${formatClock(min)}–${formatClock(max)}` : formatClock(min);
}

function markerPart(group: readonly CapturedEvent[], clock: string, budget: number): string {
  const first = group[0];
  const { tag, source } = first.element;
  const text = oneLine(eventText(first));
  const ids = group.length === 1 ? first.id : `${first.id} ×${group.length}`;
  const tail = [...(source ? [escapeMarkdown(shortSource(source))] : []), ids];
  if (text === "") return [tag, ...tail].join(" · ");

  // Length of this part rendered alone with empty quotes: *[00:04 · th «» · e1]*
  const fixed = `*[${clock} · ${[`${tag} «»`, ...tail].join(" · ")}]*`.length;
  const quoted = escapeMarkdown(truncate(text, Math.max(MIN_TEXT, budget - fixed)));
  return [`${tag} «${quoted}»`, ...tail].join(" · ");
}
