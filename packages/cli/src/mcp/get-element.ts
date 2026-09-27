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
 * Full details of one captured event (its ElementInfo, plus the event's own fields) — the MCP
 * tool for when the Markdown appendix's trimmed HTML/text isn't enough and an agent wants
 * everything recorded about the element (selector, source, styles, component). With `repo`, its
 * `element.resolved` is filled from that project's source, as get_session does for the spec.
 */
export async function getElement(sessionDir: string, eventId: string, options: RepoOption = {}): Promise<ElementResult> {
  const session = await readSessionFile(sessionDir);
  const event = session.events.find((e) => e.id === eventId);
  if (event === undefined) {
    const ids = session.events.map((e) => e.id).join(", ") || "(none)";
    throw new CliError(`No event "${eventId}" in ${sessionDir}. Event ids in this session: ${ids}`);
  }
  if (!options.repo) return { event };

  // A one-event session: the project check then looks at this element's files only.
  const local = await resolveWithRepo({ ...session, events: [event] }, options.repo.root, options.repo);
  if (local.status === "mismatch") return { event, warning: mismatchWarning(local) };
  return { event: local.session.events[0]! };
}
