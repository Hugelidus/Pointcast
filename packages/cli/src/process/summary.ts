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

export function formatFusionSummary(summary: FusionSummary): string {
  const { total, deictic, time, standalone } = summary;
  return `${total} ${total === 1 ? "event" : "events"} (${deictic} deictic, ${time} time, ${standalone} standalone)`;
}
