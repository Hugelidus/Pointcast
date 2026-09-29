import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { OFFICIAL_EXTENSION_IDS } from "@pointcast/core";
import { z } from "zod";
import { CliError } from "../errors";
import { startHandoffReceiver } from "../handoff/receiver";
import { resolveSessionsBase, skippedNewerSessionsNote, type ResolveSessionsBaseOptions } from "../process/discover";
import { announceRecording, CHANNEL_CAPABILITY } from "./channel";
import { getElement } from "./get-element";
import { VERSION } from "../version";
import { readSessionFile } from "../process/session-file";
import { getSession, listSessions, matchesProject, projectReader, resolveSessionDirById, type GetSessionResult, type RepoOption, type SessionSummary } from "./sessions";
import { RecordingWatch, type NewRecording } from "./watch";

/** Text-only tool result, the shape every tool below returns. */
function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

/**
 * `{"sessions":[…]}` with one session per line: compact, and still readable when an agent (or
 * its user) looks at the raw result.
 */
export function sessionsJson(sessions: readonly SessionSummary[]): string {
  if (sessions.length === 0) return '{"sessions":[]}';
  return `{"sessions":[\n${sessions.map((session) => JSON.stringify(session)).join(",\n")}\n]}`;
}

/**
 * The spec as get_session and wait_for_recording return it: one-line notes first (each its own
 * paragraph), then "# <id>", the header line, and the spec.
 */
function specText(notes: ReadonlyArray<string | undefined>, result: GetSessionResult): string {
  const shown = notes.filter((note): note is string => note !== undefined);
  return (shown.length ? `${shown.join("\n\n")}\n\n` : "") + `# ${result.session.id}\n\n${result.header}\n\n---\n\n${result.markdown}`;
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
  /** What wait_for_recording waits on; runMcpServer shares it with the receiver. Default: a new one on the sessions folder. */
  watch?: RecordingWatch;
  /** Test hook: how often wait_for_recording sends progress. Default PROGRESS_EVERY_MS. */
  progressEveryMs?: number;
}

const repoArgument = z
  .string()
  .optional()
  .describe(
    "Absolute path of the project the recording was made on, to find its code locations in. " +
      "Default: the project this server was started for.",
  );

const sessionIdArgument = z
  .string()
  .describe('Session id (the folder name), "latest-here" (newest recording made on this project) or "latest" (newest of all).');

/**
 * `pointcast mcp`'s 4 read-only tools, all built on the same session discovery `pointcast
 * process` uses (`--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`, D2/session-format.md).
 * Read-only by design: an MCP client is a coding agent, and this tool exists so it can look up
 * what a pointcast recording captured — not to transcribe or re-run anything. (The process also
 * receives recordings from the extension, runMcpServer below; no tool writes a session.)
 * wait_for_recording blocks until a new recording arrives (watch.ts), for "listen while I
 * record" sessions (D11 note 2026-09-29).
 *
 * Every tool carries readOnlyHint: Gemini CLI's plan mode refuses MCP tools without it.
 */
export function createServer(options: ServerOptions): McpServer {
  // The channel capability only takes effect in a Claude Code session started with --channels or
  // the development flag for this server (channel.ts); everywhere else it is ignored.
  const server = new McpServer({ name: "pointcast", version: VERSION }, { capabilities: { experimental: { [CHANNEL_CAPABILITY]: {} } } });
  const watch = options.watch ?? new RecordingWatch({ base: resolveSessionsBase(options) });
  const repoFor = (repo: string | undefined): RepoOption["repo"] =>
    repo === undefined ? { root: options.repoRoot, explicit: false } : { root: path.resolve(options.repoRoot, repo), explicit: true };

  server.registerTool(
    "list_sessions",
    {
      description:
        "List recent pointcast recordings, newest first: id, date, duration, the pages pointed at, how many requests " +
        "and elements, a preview of the first request, whether its source files are in this project (matchesProject), " +
        "and whether its spec is already on disk (rendered).",
      inputSchema: {
        limit: z.number().int().positive().max(200).optional().describe("Max sessions to return (default 20)."),
        repo: repoArgument,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, repo }) => {
      try {
        // An object, not a bare array: Gemini CLI copies JSON text into structuredContent, which
        // MCP requires to be an object, and fails the whole call otherwise.
        return text(sessionsJson(await listSessions(options, limit ?? 20, repoFor(repo))));
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
        'is not on disk yet. Pass "latest-here" for the most recent recording made on this project, or "latest" ' +
        "for the most recent one of any project. Code locations are resolved against the project's source when " +
        "the recording has them.",
      inputSchema: { id: sessionIdArgument, repo: repoArgument },
      annotations: { readOnlyHint: true },
    },
    async ({ id, repo }) => {
      try {
        const { dir, skippedNewer, note } = await resolveSessionDirById(options, id, repoFor(repo));
        const result = await getSession(dir, { repo: repoFor(repo) });
        // The watch keys recordings by folder name, the id an agent passes.
        watch.markDelivered(path.basename(dir));
        // One-liners above the spec: a folder "latest" had to skip (no session.json, usually
        // Chrome's save dialog), what "latest-here" passed over, then the project mismatch
        // getSession itself found.
        return text(specText([skippedNewerSessionsNote(skippedNewer), note, result.warning], result));
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
        id: sessionIdArgument,
        eventId: z.string().describe('Event id within the session, e.g. "e3".'),
        repo: repoArgument,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, eventId, repo }) => {
      try {
        const { dir, skippedNewer, note } = await resolveSessionDirById(options, id, repoFor(repo));
        const result = await getElement(dir, eventId, { repo: repoFor(repo) });
        const details = JSON.stringify(result.event, null, 2);
        const notes = [skippedNewerSessionsNote(skippedNewer), note, result.warning].filter((n): n is string => n !== undefined);
        return text(notes.length ? `${notes.join("\n\n")}\n\n${details}` : details);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "wait_for_recording",
    {
      description:
        "Wait for the user's next pointcast recording and return its spec. Use when the user asks you to listen/watch for " +
        "recordings; after applying one, call it again to keep listening. Returns as soon as a new recording arrives " +
        "(the user pressed Stop in the extension), with the same spec and warnings as get_session, or after " +
        'timeoutSeconds with "No new recording yet": that is not an error, call it again to keep listening. ' +
        "By default only recordings made on this project count (as with get_session's \"latest-here\"); " +
        "anyProject: true returns every recording.",
      inputSchema: {
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(
            `How long to wait, at most ${MAX_WAIT_SECONDS}. Default: what this client allows a tool call ` +
              `(${LONG_WAIT_SECONDS} for Claude Code and Gemini CLI, ${SHORT_WAIT_SECONDS} for others).`,
          ),
        anyProject: z
          .boolean()
          .optional()
          .describe(
            "Return recordings from any project. Default false: recordings whose source files are all missing from this " +
              "project are skipped (and left for an agent session on the right project); ones that name no files are kept.",
          ),
        repo: repoArgument,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ timeoutSeconds, anyProject, repo }, extra) => {
      const seconds = timeoutSeconds ?? defaultWaitSeconds(server.server.getClientVersion()?.name);
      let accept: ((dir: string) => Promise<boolean>) | undefined;
      try {
        accept = anyProject ? undefined : await projectFilter(repoFor(repo)!);
      } catch (error) {
        return toolError(error);
      }
      const stopProgress = reportProgress(extra, seconds, options.progressEveryMs ?? PROGRESS_EVERY_MS);
      let found: NewRecording | undefined;
      try {
        found = await watch.next({
          timeoutMs: seconds * 1000,
          signal: extra.signal,
          ...(accept ? { accept } : {}),
        });
      } finally {
        stopProgress();
      }
      if (found === undefined) {
        return text(`No new recording yet (waited ${formatWait(seconds)}). Call wait_for_recording again to keep listening.`);
      }
      try {
        const result = await getSession(found.dir, { repo: repoFor(repo) });
        const more =
          found.waiting === 0
            ? undefined
            : `${found.waiting} more new ${found.waiting === 1 ? "recording is" : "recordings are"} waiting: call wait_for_recording again after this one.`;
        return text(specText([`New recording ${found.id}.`, more, result.warning], result));
      } catch (error) {
        if (error instanceof CliError) return toolError(new CliError(`New recording ${found.id}, but it cannot be read: ${error.message}`));
        throw error;
      }
    },
  );

  return server;
}

/**
 * wait_for_recording's default filter, "latest-here"'s rule: a recording is this project's unless
 * it names source files and none of them is here. One project reader per call (its file scan runs
 * once), and one verdict per recording, since the poll offers the same folders again and again.
 */
async function projectFilter(repo: { root: string; explicit: boolean }): Promise<(dir: string) => Promise<boolean>> {
  const reader = await projectReader(repo);
  const verdicts = new Map<string, Promise<boolean>>();
  return (dir) => {
    let verdict = verdicts.get(dir);
    if (verdict === undefined) {
      verdict = readSessionFile(dir).then(
        async (session) => (await matchesProject(session, reader)) !== false,
        // Unreadable: let get_session say why rather than wait on it forever.
        () => true,
      );
      verdicts.set(dir, verdict);
    }
    return verdict;
  };
}

/** The longest wait_for_recording accepts: under Claude Code's 30-minute idle limit for stdio servers, even with no progress. */
export const MAX_WAIT_SECONDS = 1500;
/** Claude Code (no tool time limit by default) and Gemini CLI (10 minutes per call by default). */
export const LONG_WAIT_SECONDS = 540;
/** Everyone else: Codex stops a tool call after 60 s by default, and so does the MCP SDK's own client. */
export const SHORT_WAIT_SECONDS = 50;
/** Progress notifications while waiting, for clients that reset their timeout on them. */
const PROGRESS_EVERY_MS = 25_000;

/** The default wait for the client named in `initialize` (clientInfo.name). */
export function defaultWaitSeconds(clientName: string | undefined): number {
  return /claude-code|gemini/i.test(clientName ?? "") ? LONG_WAIT_SECONDS : SHORT_WAIT_SECONDS;
}

function formatWait(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

type ToolExtra = {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total: number; message: string } }) => Promise<void>;
};

/**
 * Sends notifications/progress every PROGRESS_EVERY_MS while waiting, when the client asked for
 * progress (a progressToken): clients that reset their timeout on progress then never cut a
 * long wait. Progress is the seconds waited, out of the timeout. Returns the stop function.
 */
function reportProgress(extra: ToolExtra, seconds: number, everyMs: number): () => void {
  const token = extra._meta?.progressToken;
  if (token === undefined) return () => {};
  const started = Date.now();
  let last = 0;
  const timer = setInterval(() => {
    // MCP requires progress to increase with each notification.
    const waited = Math.max(last + 0.001, (Date.now() - started) / 1000);
    last = waited;
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: waited, total: seconds, message: "Waiting for a pointcast recording…" },
      })
      .catch(() => {});
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Connects the server to stdio (the client disconnecting ends the process), then, unless
 * `handoffPort` is undefined, receives recordings from the extension into the sessions folder the
 * tools read (D11). The receiver must never cost the agent its tools: a failure to start is only
 * logged, and it is closed when stdin ends, because the SDK's transport ignores that and an open
 * listener would otherwise keep a dead server alive.
 */
export async function runMcpServer(options: ServerOptions): Promise<void> {
  const watch = options.watch ?? new RecordingWatch({ base: resolveSessionsBase(options) });
  const server = createServer({ ...options, watch });
  await server.connect(new StdioServerTransport());
  const log = (message: string) => console.error(`[pointcast] ${message}`);
  if (options.handoffPort === undefined) return;
  try {
    const receiver = startHandoffReceiver({
      base: resolveSessionsBase(options),
      port: options.handoffPort,
      allowedExtensionIds: options.allowedExtensionIds ?? new Set(OFFICIAL_EXTENSION_IDS),
      version: VERSION,
      onStored: (id) => {
        watch.stored(id);
        void announceRecording(server, path.join(resolveSessionsBase(options), id), log);
      },
    });
    const stop = () => void receiver.close();
    process.stdin.once("end", stop);
    process.stdin.once("close", stop);
  } catch (error) {
    console.error(`[pointcast] could not receive recordings from the extension (${(error as Error).message})`);
  }
}
