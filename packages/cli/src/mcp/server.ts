import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { z } from "zod";
import { CliError } from "../errors";
import { skippedNewerSessionsNote, type ResolveSessionsBaseOptions } from "../process/discover";
import { getElement } from "./get-element";
import { VERSION } from "../version";
import { getSession, listSessions, resolveSessionDirById, type RepoOption } from "./sessions";

/** Text-only tool result, the shape every tool below returns. */
function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

/** A CliError is a message meant to be shown as-is; anything else is unexpected and rethrown. */
function toolError(error: unknown) {
  if (error instanceof CliError) return { content: [{ type: "text" as const, text: error.message }], isError: true };
  throw error;
}

export interface ServerOptions extends ResolveSessionsBaseOptions {
  /**
   * Project folder to resolve code pointers in when a tool call names none: `--repo`, else
   * CLAUDE_PROJECT_DIR (Claude Code sets it for the servers it starts, which may run in another
   * directory: plugin and user-scope servers start in ~/.claude), else the working directory.
   */
  repoRoot: string;
}

const repoArgument = z
  .string()
  .optional()
  .describe(
    "Absolute path of the project the recording was made on, to find its code locations in. " +
      "Default: the project this server was started for.",
  );

/**
 * `pointcast mcp`'s 3 read-only tools, all built on the same session discovery `pointcast
 * process` uses (`--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`, D2/session-format.md).
 * Read-only by design: an MCP client is a coding agent, and this tool exists so it can look up
 * what a pointcast recording captured — not to transcribe or re-run anything.
 */
export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "pointcast", version: VERSION });
  const repoFor = (repo: string | undefined): RepoOption["repo"] =>
    repo === undefined ? { root: options.repoRoot, explicit: false } : { root: path.resolve(options.repoRoot, repo), explicit: true };

  server.registerTool(
    "list_sessions",
    {
      description: "List recent pointcast recordings (id, date, duration, event count), newest first.",
      inputSchema: { limit: z.number().int().positive().max(200).optional().describe("Max sessions to return (default 20).") },
    },
    async ({ limit }) => {
      try {
        return text(await listSessions(options, limit ?? 20));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_session",
    {
      description:
        "Get a session's Markdown spec (session.md), rendering it from session.json + words.json if it " +
        'is not on disk yet. Pass "latest" for the most recent session. Code locations are resolved ' +
        "against the project's source when the recording has them.",
      inputSchema: { id: z.string().describe('Session id (the folder name), or "latest".'), repo: repoArgument },
    },
    async ({ id, repo }) => {
      try {
        const { dir, skippedNewer } = await resolveSessionDirById(options, id);
        const result = await getSession(dir, { repo: repoFor(repo) });
        // Both are one-liners above the spec: a folder "latest" had to skip (no session.json,
        // usually Chrome's save dialog), then the project mismatch getSession itself found.
        const notes = [skippedNewerSessionsNote(skippedNewer), result.warning].filter((n): n is string => n !== undefined);
        return text(
          (notes.length ? `${notes.join("\n\n")}\n\n` : "") +
            `# ${result.session.id}\n\n${result.summaryLine} · ${result.chars} chars · ~${result.tokens} tokens\n\n---\n\n${result.markdown}`,
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_element",
    {
      description: "Get the full captured details (ElementInfo) of one event in a session by its event id.",
      inputSchema: {
        id: z.string().describe('Session id (the folder name), or "latest".'),
        eventId: z.string().describe('Event id within the session, e.g. "e3".'),
        repo: repoArgument,
      },
    },
    async ({ id, eventId, repo }) => {
      try {
        const { dir, skippedNewer } = await resolveSessionDirById(options, id);
        const result = await getElement(dir, eventId, { repo: repoFor(repo) });
        const details = JSON.stringify(result.event, null, 2);
        const notes = [skippedNewerSessionsNote(skippedNewer), result.warning].filter((n): n is string => n !== undefined);
        return text(notes.length ? `${notes.join("\n\n")}\n\n${details}` : details);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

/** Connects the server to stdio and never resolves (the client disconnecting ends the process). */
export async function runMcpServer(options: ServerOptions): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
}
