import type { CapturedEvent } from "@pointcast/core";
import { CliError } from "../errors";
import { readSessionFile } from "../process/session-file";
import { mismatchWarning, resolveWithRepo } from "../resolve/local";
import type { RepoOption } from "./sessions";

export interface ElementResult {
  event: CapturedEvent;
  /** One line to show above the details: the recording looks like it is from another project. */
  warning?: string;
}

/**
 * "its event ids are e1…e17, in the order the user pointed": the range when the ids are the
 * extension's own e1, e2… in order, else the list (a hand-edited or older session).
 */
export function validEventIds(events: readonly Pick<CapturedEvent, "id">[]): string {
  if (events.length === 0) return "it has no events (nothing was pointed at).";
  const ids = events.map((e) => e.id);
  const sequential = ids.every((id, i) => id === `e${i + 1}`);
  if (sequential) return ids.length === 1 ? 'its only event id is "e1".' : `its event ids are e1…e${ids.length}, in the order the user pointed.`;
  return `its event ids are ${ids.join(", ")}.`;
}

/**
 * Full details of one captured event (its ElementInfo, plus the event's own fields) — the MCP
 * tool for when the Markdown appendix's trimmed HTML/text isn't enough and an agent wants
 * everything recorded about the element (selector, source, styles, component). With `repo`, its
 * `element.resolved` is filled from that project's source, as get_session does for the spec.
 */
export async function getElement(sessionDir: string, eventId: string, options: RepoOption = {}): Promise<ElementResult> {
  const session = await readSessionFile(sessionDir);
  const event = session.events.find((e) => e.id === eventId);
  if (event === undefined) throw new CliError(`No event "${eventId}" in recording ${session.id}: ${validEventIds(session.events)}`);
  if (!options.repo) return { event };

  // A one-event session: the project check then looks at this element's files only.
  const local = await resolveWithRepo({ ...session, events: [event] }, options.repo.root, options.repo);
  if (local.status === "mismatch") return { event, warning: mismatchWarning(local) };
  return { event: local.session.events[0]! };
}
