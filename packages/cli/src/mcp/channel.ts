import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import { readSessionFile } from "../process/session-file";
import { summarizeSession } from "./sessions";

/**
 * Claude Code "channels" (research preview, code.claude.com/docs/en/channels-reference): a server
 * that declares this experimental capability can push a message into the session, which Claude
 * then acts on without being asked. Claude Code only listens when the user started it with
 * `--channels` or `--dangerously-load-development-channels` naming this server; otherwise it drops
 * the message silently. So declaring it changes nothing for anyone who did not opt in.
 */
export const CHANNEL_CAPABILITY = "claude/channel";
export const CHANNEL_NOTIFICATION = "notifications/claude/channel";

/** Pages named in the message at most, and characters per page. */
const MAX_PAGES = 3;
const MAX_PAGE_CHARS = 40;

export interface ChannelMessage {
  content: string;
  /** Attributes of the <channel> tag: identifier keys only (others are dropped by Claude Code). */
  meta: { sessionId: string };
}

/**
 * "New pointcast recording <id>: 3 requests on localhost:5173/orders. Apply it with the pointcast
 * tools (get_session, id "<id>")." Never the spec, nor any text the user said or the page showed:
 * a channel message goes straight into the agent's context, and a page's text could otherwise
 * give it instructions. Only the id (checked by the receiver against the session id pattern),
 * counts, and page host/paths reduced to URL characters and cut short.
 */
export async function channelMessage(sessionDir: string): Promise<ChannelMessage> {
  const id = path.basename(sessionDir);
  const session = await readSessionFile(sessionDir);
  const summary = await summarizeSession(sessionDir, session, undefined);
  const what =
    summary.requests === undefined
      ? `${summary.elements} ${summary.elements === 1 ? "element" : "elements"}`
      : `${summary.requests} ${summary.requests === 1 ? "request" : "requests"}`;
  const pages = summary.pages
    .filter((page) => !page.startsWith("+"))
    .slice(0, MAX_PAGES)
    .map((page) => page.replace(/[^A-Za-z0-9._~:/%+-]/g, "").slice(0, MAX_PAGE_CHARS))
    .filter((page) => page !== "");
  const where = pages.length === 0 ? "" : ` on ${pages.join(", ")}${summary.pages.length > pages.length ? ", …" : ""}`;
  return {
    content: `New pointcast recording ${id}: ${what}${where}. Apply it with the pointcast tools (get_session, id "${id}").`,
    meta: { sessionId: id },
  };
}

/** Claude Code names itself so in `initialize`; no other client gets a notification it does not know. */
export function isClaudeCode(clientName: string | undefined): boolean {
  return /^claude-code/i.test(clientName ?? "");
}

/**
 * Tells a Claude Code session a recording arrived (for the receiver's onStored). Best effort:
 * nothing is sent to other clients, and a failure is only logged, since the recording is stored
 * and wait_for_recording or get_session still get it.
 */
export async function announceRecording(server: McpServer, sessionDir: string, log: (message: string) => void): Promise<void> {
  if (!isClaudeCode(server.server.getClientVersion()?.name)) return;
  try {
    const message = await channelMessage(sessionDir);
    await server.server.notification({ method: CHANNEL_NOTIFICATION, params: { ...message } });
  } catch (error) {
    log(`could not announce recording ${path.basename(sessionDir)} (${(error as Error).message})`);
  }
}
