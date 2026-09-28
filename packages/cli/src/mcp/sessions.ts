import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateTokens, fuse, isTypedSession, renderMarkdown, TYPED_SESSION_WORDS, type SessionFile, type WordsFile } from "@pointcast/core";
import { CliError } from "../errors";
import { listSessionDirs, resolveSessionsBase, type ResolveSessionsBaseOptions } from "../process/discover";
import { mismatchWarning, resolveWithRepo } from "../resolve/local";
import { readSessionFile } from "../process/session-file";
import { formatFusionSummary, formatTypedSummary, summarizeFusion } from "../process/summary";
import { readWordsFileIfPresent } from "../process/words-file";

/** What `list_sessions` reports for one session — enough to pick one, not its full contents. */
export interface SessionSummary {
  id: string;
  dir: string;
  startedAt: string;
  durationMs: number;
  eventCount: number;
}

/**
 * Every session under the sessions folder (same discovery as `pointcast process`: `--dir` /
 * `POINTCAST_DIR` / `<Downloads>/pointcast`), newest first. A folder whose session.json is
 * missing or malformed is skipped rather than failing the whole list — the MCP tool is read-only
 * and should stay useful even if one folder is a leftover or a hand-edited fixture.
 */
export async function listSessions(options: ResolveSessionsBaseOptions, limit?: number): Promise<SessionSummary[]> {
  const base = resolveSessionsBase(options);
  const { dirs } = await listSessionDirs(base);
  const summaries: SessionSummary[] = [];
  for (const dir of limit === undefined ? dirs : dirs.slice(0, limit)) {
    const session = await readSessionFile(dir).catch(() => undefined);
    if (session === undefined) continue;
    summaries.push({
      id: session.id,
      dir,
      startedAt: session.startedAt,
      durationMs: session.durationMs,
      eventCount: session.events.length,
    });
  }
  return summaries;
}

export interface ResolvedSessionDirById {
  dir: string;
  /** Newer folders with no session.json that "latest" skipped (skippedNewerSessionsNote); always
   * empty for an explicit id, which is never checked against the folder listing. */
  skippedNewer: string[];
}

/**
 * Resolves "latest" the same way `pointcast process` does; an explicit id is joined onto the
 * base. The id comes from a coding agent, which text captured from a web page could steer, so it
 * must be one folder name: "../elsewhere" would read, and let getSession write session.md,
 * outside the sessions folder. Nor may it start with ".": ".incoming-…" is a recording the MCP
 * server is still receiving (handoff/store.ts), and "." and ".." are not folder names.
 */
export async function resolveSessionDirById(
  options: ResolveSessionsBaseOptions,
  id: string,
): Promise<ResolvedSessionDirById> {
  const base = resolveSessionsBase(options);
  if (id === "latest") {
    const { dirs, skippedNewer } = await listSessionDirs(base);
    return { dir: dirs[0]!, skippedNewer };
  }
  if (id === "" || id.startsWith(".") || /[\\/]/.test(id) || id !== path.basename(id)) {
    throw new CliError(`"${id}" is not a session id: pass a folder name from list_sessions, or "latest".`);
  }
  return { dir: path.join(base, id), skippedNewer: [] };
}

export interface GetSessionResult {
  session: SessionFile;
  markdown: string;
  /** True when this call rendered the Markdown instead of reading session.md from disk. */
  rendered: boolean;
  chars: number;
  tokens: number;
  summaryLine: string;
  /** One line to show above the spec: the recording looks like it is from another project. */
  warning?: string;
}

/** The project folder to resolve code pointers in (route 1); `explicit` when the caller named it. */
export interface RepoOption {
  repo?: { root: string; explicit: boolean };
}

/**
 * Returns a session's Markdown spec: session.md if it is already on disk (v2 sessions from the
 * extension, or anything `pointcast process` already ran on), else rendered on the fly from
 * session.json + words.json. Never transcribes — this tool is read-only, so a session with no
 * words.json and no audio (or one whose audio was never processed) fails with a clear message
 * telling the caller to run `pointcast process` first.
 *
 * With `repo`, a recording whose code chain is found in that project is re-rendered with its
 * resolved code locations (not cached: they depend on the project, session.md does not), and one
 * whose chain files are all missing there gets a warning instead.
 */
export async function getSession(sessionDir: string, options: RepoOption = {}): Promise<GetSessionResult> {
  const session = await readSessionFile(sessionDir);
  const local = options.repo ? await resolveWithRepo(session, options.repo.root, options.repo) : undefined;
  const warning = local?.status === "mismatch" ? mismatchWarning(local) : undefined;
  // A typed session (D12) renders from its notes: it never has a words.json, and needs none.
  const words = isTypedSession(session) ? TYPED_SESSION_WORDS : await readWordsFileIfPresent(sessionDir);
  if (local?.status === "resolved" && words !== undefined) {
    const markdown = renderMarkdown(local.session, words);
    return {
      session: local.session,
      markdown,
      rendered: true,
      chars: markdown.length,
      tokens: estimateTokens(markdown),
      summaryLine: summaryLineOf(session, words),
    };
  }
  return { ...(await getStoredSession(sessionDir, session, words)), ...(warning ? { warning } : {}) };
}

async function getStoredSession(sessionDir: string, session: SessionFile, words: WordsFile | undefined): Promise<GetSessionResult> {
  const mdPath = path.join(sessionDir, "session.md");

  const existing = await readFile(mdPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new CliError(`Could not read ${mdPath}: ${error.message}`);
  });

  if (existing !== undefined && words === undefined) {
    // session.md exists but words.json doesn't (or was removed) — trust the file on disk rather
    // than fail; there is nothing to re-render from anyway.
    return {
      session,
      markdown: existing,
      rendered: false,
      chars: existing.length,
      tokens: estimateTokens(existing),
      summaryLine: "session.md read from disk (no words.json to summarize)",
    };
  }
  if (words === undefined) {
    throw new CliError(
      `${sessionDir} has no session.md and no words.json to render one from. Run "pointcast process ${sessionDir}" first.`,
    );
  }

  const markdown = existing ?? renderMarkdown(session, words);
  const summaryLine = summaryLineOf(session, words);

  if (existing === undefined) {
    // Cache it like `process` does, so a second call (or a later `pointcast process`) does not
    // re-render — session.md is meant to be a normal file in the session folder either way.
    await writeFile(mdPath, markdown, "utf8").catch(() => {
      // Best-effort: a read-only sessions folder should not stop the tool from returning content.
    });
  }

  return {
    session,
    markdown,
    rendered: existing === undefined,
    chars: markdown.length,
    tokens: estimateTokens(markdown),
    summaryLine,
  };
}

/** What `process` prints too: fusion's counts, or the notes' for a typed session (D12). */
function summaryLineOf(session: SessionFile, words: WordsFile): string {
  if (isTypedSession(session)) return formatTypedSummary(session);
  return formatFusionSummary(summarizeFusion(fuse(session.events, words.words).placements));
}
