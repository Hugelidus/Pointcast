import type { Placement } from "@pointcast/core";

export interface FusionSummary {
  total: number;
  /** Placements anchored to a deictic word ("esto"), directly or via a burst that shares one. */
  deictic: number;
  /** Placements anchored to a nearby pause or word, i.e. by time rather than by a deictic. */
  time: number;
  /** Placements outside speech or in a long silence, rendered on a line of their own. */
  standalone: number;
}

/**
 * Buckets fuse()'s per-event placements into the three categories the task asks the CLI to
 * report (D4's five AnchorKinds collapse to these): deictic / time (pause or word) /
 * standalone. A burst placement (fuse.ts: "shares the anchor of another event of its burst")
 * is counted under whatever its leader resolved to, not as its own bucket, so a rapid chain of
 * clicks anchored to one deictic is reported as deictic hits, not as a fourth, meaningless
 * "burst" category. `sharedWith` always points at a non-burst placement (fuse.ts's own
 * invariant), so one lookup is enough — no chain to walk.
 */
export function summarizeFusion(placements: readonly Placement[]): FusionSummary {
  const byId = new Map(placements.map((p) => [p.eventId, p]));

  const summary: FusionSummary = { total: placements.length, deictic: 0, time: 0, standalone: 0 };
  for (const placement of placements) {
    const resolved = placement.kind === "burst" ? (byId.get(placement.sharedWith ?? "")?.kind ?? placement.kind) : placement.kind;
    if (resolved === "deictic") summary.deictic++;
    else if (resolved === "standalone") summary.standalone++;
    else summary.time++; // "pause" | "word" (and the defensive "burst" fallback above)
  }
  return summary;
}

/**
 * The one line above a spec (get_session, wait_for_recording) and after `pointcast process`:
 * "8 requests · 17 elements · ~3,100 tokens". What the user asked for and pointed at, and what
 * reading it costs; no fusion jargon (deictic, standalone), and no character count. The requests
 * are left out when the spec has none to count (the classic format).
 */
export function formatSpecHeader(counts: { requests: number | undefined; elements: number; tokens: number }): string {
  const parts = [
    ...(counts.requests === undefined ? [] : [plural(counts.requests, "request")]),
    plural(counts.elements, "element"),
    `~${roughTokens(counts.tokens).toLocaleString("en-US")} tokens`,
  ];
  return parts.join(" · ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** An estimate shown as one: to the 10 under 1,000, to the 100 above. */
function roughTokens(tokens: number): number {
  const step = tokens < 1_000 ? 10 : 100;
  return Math.max(step, Math.round(tokens / step) * step);
}

/** What a rendered spec holds, read back from its Markdown (the `requests` format's headings). */
export interface SpecStats {
  /** Its "## Request N" headings; undefined for the classic format, which has none. */
  requests: number | undefined;
  /** The first request's quote, without the [a] markers, cut to PREVIEW_CHARS. */
  preview: string | undefined;
}

export const PREVIEW_CHARS = 80;

/**
 * Read from the Markdown rather than recomputed, so it describes exactly the spec an agent gets,
 * whichever renderer wrote it (the extension's session.md, or this CLI's).
 */
export function specStats(markdown: string): SpecStats {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => (/^## Request \d+\s*$/.test(line) ? [index] : []));
  if (headings.length === 0) return { requests: undefined, preview: undefined };
  const first = lines.slice(headings[0]! + 1).find((line) => line.trim() !== "");
  return { requests: headings.length, preview: first === undefined ? undefined : previewOf(first) };
}

function previewOf(line: string): string | undefined {
  const text = line
    .replace(/^>\s?/, "")
    // The pointing markers ([a], [a, b], [c–e]) are the only unescaped brackets in a quote.
    .replace(/\s*(?<!\\)\[[a-z](?:[\s,–-]+[a-z])*\]/g, "")
    .replace(/\\([\\`*_[\]<>~])/g, "$1")
    .replace(/^_(.*)_$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return undefined;
  // By code point, so an emoji is never cut in half.
  const chars = Array.from(text);
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS - 1).join("").trimEnd()}…` : text;
}
