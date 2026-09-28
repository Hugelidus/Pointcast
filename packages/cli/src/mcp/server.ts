import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { OFFICIAL_EXTENSION_IDS } from "@pointcast/core";
import { z } from "zod";
import { CliError } from "../errors";
import { startHandoffReceiver } from "../handoff/receiver";
import { resolveSessionsBase, skippedNewerSessionsNote, type ResolveSessionsBaseOptions } from "../process/discover";
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
  /** Port to receive recordings from the extension on (D11, handoff/config.ts); undefined: no receiver. */
  handoffPort?: number;
  /** Extension ids the receiver accepts; default OFFICIAL_EXTENSION_IDS. */
  allowedExtensionIds?: ReadonlySet<string>;
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
 * what a pointcast recording captured — not to transcribe or re-run anything. (The process also
 * receives recordings from the extension, runMcpServer below; no tool writes a session.)
 *
 * Every tool carries readOnlyHint: Gemini CLI's plan mode refuses MCP tools without it.
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
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      try {
        // An object, not a bare array: Gemini CLI copies JSON text into structuredContent, which
        // MCP requires to be an object, and fails the whole call otherwise.
        return text({ sessions: await listSessions(options, limit ?? 20) });
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
      annotations: { readOnlyHint: true },
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
      description:
        "Get the full captured details (ElementInfo) of one event in a session by its event id, with the page errors captured around it (stack frames included) when there were any.",
      inputSchema: {
        id: z.string().describe('Session id (the folder name), or "latest".'),
        eventId: z.string().describe('Event id within the session, e.g. "e3".'),
        repo: repoArgument,
      },
      annotations: { readOnlyHint: true },
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

/**
 * Connects the server to stdio (the client disconnecting ends the process), then, unless
 * `handoffPort` is undefined, receives recordings from the extension into the sessions folder the
 * tools read (D11). The receiver must never cost the agent its tools: a failure to start is only
 * logged, and it is closed when stdin ends, because the SDK's transport ignores that and an open
 * listener would otherwise keep a dead server alive.
 */
export async function runMcpServer(options: ServerOptions): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
  if (options.handoffPort === undefined) return;
  try {
    const receiver = startHandoffReceiver({
      base: resolveSessionsBase(options),
      port: options.handoffPort,
      allowedExtensionIds: options.allowedExtensionIds ?? new Set(OFFICIAL_EXTENSION_IDS),
      version: VERSION,
    });
    const stop = () => void receiver.close();
    process.stdin.once("end", stop);
    process.stdin.once("close", stop);
  } catch (error) {
    console.error(`[pointcast] could not receive recordings from the extension (${(error as Error).message})`);
  }
}
