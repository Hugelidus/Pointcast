import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cachingReader,
  estimateTokens,
  fuse,
  isTypedSession,
  projectMatch,
  renderMarkdown,
  TYPED_SESSION_WORDS,
  type SessionFile,
  type SourceReader,
  type WordsFile,
} from "@pointcast/core";
import { CliError } from "../errors";
import { listSessionDirs, resolveSessionsBase, type ResolveSessionsBaseOptions } from "../process/discover";
import { mismatchWarning, resolveWithRepo } from "../resolve/local";
import { readSessionFile } from "../process/session-file";
import { formatFusionSummary, formatTypedSummary, specStats, summarizeFusion } from "../process/summary";
import { createRepoReader } from "../resolve/repo-reader";
import { readWordsFileIfPresent } from "../process/words-file";

/** What `list_sessions` reports for one session: enough to tell recordings apart and pick one. */
export interface SessionSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  /** Where the user pointed: host and path of each page, first seen first (pagesOf). */
  pages: string[];
  /** The spec's requests; absent when it has none to count (classic format, not processed yet). */
  requests?: number;
  /** Elements pointed at: the recording's events. */
  elements: number;
  /** The first request's quote, cut to ~80 characters. */
  preview?: string;
  /**
   * Whether the source files the recording points at exist in the project (the check behind
   * get_session's other-project warning); "unknown" when it names none (production build, older
   * extension) or the project folder does not exist.
   */
  matchesProject: boolean | "unknown";
  /** Whether its session.md is on disk: false means it is rendered (or processed) on first use. */
  rendered: boolean;
}

/** Pages listed at most by pagesOf; more are summed up as "+N more". */
const MAX_PAGES = 3;

/**
 * The distinct pages of a recording, as "host/path" (no scheme, query or fragment: short, and a
 * query can hold a token), in the order first pointed at.
 */
export function pagesOf(session: Pick<SessionFile, "events">, max: number = MAX_PAGES): string[] {
  const pages: string[] = [];
  for (const event of session.events) {
    let page: string;
    try {
      const url = new URL(event.url);
      page = `${url.host}${url.pathname}`;
    } catch {
      continue;
    }
    if (!pages.includes(page)) pages.push(page);
  }
  return pages.length > max ? [...pages.slice(0, max), `+${pages.length - max} more`] : pages;
}

/**
 * A reader of the project to check recordings against, shared by every session of one call so
 * its bounded file scan runs once; undefined when the folder does not exist (only an error when
 * the caller named it, as in resolveWithRepo).
 */
export async function projectReader(repo: { root: string; explicit: boolean }): Promise<SourceReader | undefined> {
  const isDir = await stat(repo.root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (isDir) return cachingReader(createRepoReader(repo.root));
  if (repo.explicit) throw new CliError(`The project folder ${repo.root} does not exist or is not a folder.`);
  return undefined;
}

/** projectMatch as list_sessions reports it. */
export async function matchesProject(session: SessionFile, reader: SourceReader | undefined): Promise<boolean | "unknown"> {
  if (reader === undefined) return "unknown";
  return (await projectMatch(session, reader)).matches ?? "unknown";
}

/**
 * The session's spec without writing anything: session.md when it is on disk, else rendered in
 * memory from words.json (or a typed session's notes); undefined when neither exists yet.
 */
async function readSpec(sessionDir: string, session: SessionFile): Promise<{ markdown: string; onDisk: boolean } | undefined> {
  const existing = await readFile(path.join(sessionDir, "session.md"), "utf8").catch(() => undefined);
  if (existing !== undefined) return { markdown: existing, onDisk: true };
  const words = isTypedSession(session) ? TYPED_SESSION_WORDS : await readWordsFileIfPresent(sessionDir).catch(() => undefined);
  return words === undefined ? undefined : { markdown: renderMarkdown(session, words), onDisk: false };
}

/** One list_sessions entry. */
export async function summarizeSession(sessionDir: string, session: SessionFile, reader: SourceReader | undefined): Promise<SessionSummary> {
  const spec = await readSpec(sessionDir, session);
  const stats = spec === undefined ? undefined : specStats(spec.markdown);
  return {
    // The folder name: the id get_session takes (the same as session.json's, unless a folder was renamed).
    id: path.basename(sessionDir),
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    pages: pagesOf(session),
    ...(stats?.requests === undefined ? {} : { requests: stats.requests }),
    elements: session.events.length,
    ...(stats?.preview === undefined ? {} : { preview: stats.preview }),
    matchesProject: await matchesProject(session, reader),
    rendered: spec?.onDisk ?? false,
  };
}

/**
 * Every session under the sessions folder (same discovery as `pointcast process`: `--dir` /
 * `POINTCAST_DIR` / `<Downloads>/pointcast`), newest first. A folder whose session.json is
 * missing or malformed is skipped rather than failing the whole list — the MCP tool is read-only
 * and should stay useful even if one folder is a leftover or a hand-edited fixture. With `repo`,
 * each says whether it matches that project; without, "unknown".
 */
export async function listSessions(
  options: ResolveSessionsBaseOptions,
  limit?: number,
  repo?: { root: string; explicit: boolean },
): Promise<SessionSummary[]> {
  const base = resolveSessionsBase(options);
  const { dirs } = await listSessionDirs(base);
  const reader = repo === undefined ? undefined : await projectReader(repo);
  const summaries: SessionSummary[] = [];
  for (const dir of limit === undefined ? dirs : dirs.slice(0, limit)) {
    const session = await readSessionFile(dir).catch(() => undefined);
    if (session === undefined) continue;
    summaries.push(await summarizeSession(dir, session, reader));
  }
  return summaries;
}

export interface ResolvedSessionDirById {
  dir: string;
  /** Newer folders with no session.json that "latest" skipped (skippedNewerSessionsNote); always
   * empty for an explicit id, which is never checked against the folder listing. */
  skippedNewer: string[];
  /** "latest-here" only: one line on what it passed over, or that it fell back to "latest". */
  note?: string;
}

/** Recordings "latest-here" looks through, newest first, before falling back to "latest". */
export const LATEST_HERE_LOOKBACK = 20;

/**
 * Resolves "latest" the same way `pointcast process` does, and "latest-here" to the newest of
 * the LATEST_HERE_LOOKBACK newest recordings not known to be from another project (latestHere).
 * An explicit id is joined onto the base. The id comes from a coding agent, which text captured
 * from a web page could steer, so it must be one folder name: "../elsewhere" would read, and let
 * getSession write session.md, outside the sessions folder. Nor may it start with ".":
 * ".incoming-…" is a recording the MCP server is still receiving (handoff/store.ts), and "." and
 * ".." are not folder names.
 */
export async function resolveSessionDirById(
  options: ResolveSessionsBaseOptions,
  id: string,
  repo?: { root: string; explicit: boolean },
): Promise<ResolvedSessionDirById> {
  const base = resolveSessionsBase(options);
  if (id === "latest" || id === "latest-here") {
    const { dirs, skippedNewer } = await listSessionDirs(base);
    if (id === "latest" || repo === undefined) return { dir: dirs[0]!, skippedNewer };
    return { ...(await latestHere(dirs, repo)), skippedNewer };
  }
  if (id === "" || id.startsWith(".") || /[\\/]/.test(id) || id !== path.basename(id)) {
    throw new CliError(`"${id}" is not a session id: pass a folder name from list_sessions, "latest" or "latest-here".`);
  }
  return { dir: path.join(base, id), skippedNewer: [] };
}

/**
 * "latest-here": the newest recording whose source files are in the project, or that names none
 * (matchesProject "unknown": a production build or a Django page may have no chain, and skipping
 * those would make "latest-here" skip every recording of such a project). Only recordings that
 * name files, none of which is in the project, are passed over, and the note says which. When
 * every one looked at is from elsewhere, it is plain "latest", and get_session's own warning
 * then says the recording looks like another project's.
 */
async function latestHere(dirs: readonly string[], repo: { root: string; explicit: boolean }): Promise<{ dir: string; note?: string }> {
  const reader = await projectReader(repo);
  if (reader === undefined) return { dir: dirs[0]! };
  const passed: string[] = [];
  for (const dir of dirs.slice(0, LATEST_HERE_LOOKBACK)) {
    const session = await readSessionFile(dir).catch(() => undefined);
    // A malformed session.json is left to "latest" and get_session's own error.
    if (session === undefined) continue;
    if ((await matchesProject(session, reader)) === false) {
      passed.push(path.basename(dir));
      continue;
    }
    if (passed.length === 0) return { dir };
    const which = passed.length === 1 ? "recording" : "recordings";
    return { dir, note: `Skipped ${passed.length} newer ${which} from another project (${passed.join(", ")}).` };
  }
  if (passed.length === 0) return { dir: dirs[0]! };
  return {
    dir: dirs[0]!,
    note: `None of the ${passed.length} newest recordings points at files in \`${repo.root}\`: this is the newest one.`,
  };
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
