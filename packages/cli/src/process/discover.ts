import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SESSIONS_FOLDER } from "@pointcast/core";
import { CliError } from "../errors";
import { downloadsDir } from "./downloads-dir";

export interface ResolveSessionDirOptions {
  /** The `[session-dir]` positional, if the user gave one. Takes priority over everything else. */
  explicit?: string;
  /** `--dir`. */
  dirFlag?: string;
  /** `POINTCAST_DIR`. */
  envDir?: string;
  /** Injected for tests; defaults to the user's Downloads folder (downloads-dir.ts). */
  downloadsDir?: string;
}

export interface ResolvedSessionDir {
  dir: string;
  /** How it was chosen, printed by the CLI so a surprising pick is easy to spot. */
  reason: string;
}

/**
 * "YYYY-MM-DD_HH-mm-ss", optionally "-N" when two sessions started in the same second
 * (the extension's session-id.ts). Local time of the recording's start.
 */
const SESSION_ID = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?$/;

interface Candidate {
  name: string;
  /** Epoch ms used for ordering. */
  time: number;
  /** Same-second order ("-2" = 2); 1 for a plain id. */
  sequence: number;
  byName: boolean;
  /** Whether `<base>/<name>/session.json` exists — the folder is empty otherwise (see listSessionDirs). */
  hasSessionFile: boolean;
}

function fromSessionId(name: string): Omit<Candidate, "name" | "hasSessionFile"> | undefined {
  const match = SESSION_ID.exec(name);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, sequence] = match.map(Number);
  const time = new Date(year!, month! - 1, day!, hour!, minute!, second!).getTime();
  return { time, sequence: Number.isNaN(sequence) ? 1 : sequence!, byName: true };
}

/** Options shared by `resolveSessionDir` and `mcp`'s `list_sessions`/`get_session` tools. */
export interface ResolveSessionsBaseOptions {
  dirFlag?: string;
  envDir?: string;
  /** Injected for tests; defaults to the user's Downloads folder (downloads-dir.ts). */
  downloadsDir?: string;
}

/** Advice printed (or thrown) whenever the sessions folder can't be found or is empty. */
const NO_SESSIONS_HINT =
  "Pass a session directory, or point --dir / POINTCAST_DIR at the pointcast folder inside the folder " +
  "where Chrome saves downloads (chrome://settings/downloads).";

/**
 * Chrome's "Ask where to save each file before downloading" setting makes the extension's
 * downloads pop a Save dialog anyway: a folder can be created and then never get its session.json
 * because every file was saved (or the dialog was cancelled) somewhere else. Reused by the two
 * places that tell a caller about it.
 */
const ASK_WHERE_HINT =
  'if Chrome asked where to save the files, they are wherever you saved them; turn off "Ask where to save ' +
  'each file before downloading" in chrome://settings/downloads.';

/**
 * "Skipped 1 newer session folder with no session.json (id): ..." — appended to
 * `resolveSessionDir`'s reason and used as an MCP warning line (mcp/server.ts) whenever folders
 * newer than the picked "latest" exist but have no session.json. Undefined when none were.
 */
export function skippedNewerSessionsNote(skippedNewer: readonly string[]): string | undefined {
  if (skippedNewer.length === 0) return undefined;
  const folders = skippedNewer.length === 1 ? "folder" : "folders";
  return `Skipped ${skippedNewer.length} newer session ${folders} with no session.json (${skippedNewer.join(", ")}): ${ASK_WHERE_HINT}`;
}

/** `--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`, in that order — shared by every command
 * that looks at "the sessions folder" instead of one explicit directory. */
export function resolveSessionsBase(options: ResolveSessionsBaseOptions): string {
  return options.dirFlag ?? options.envDir ?? path.join(options.downloadsDir ?? downloadsDir(), SESSIONS_FOLDER);
}

export interface SessionDirs {
  /** Folders under `base` that have a session.json, newest first (same ordering as
   * `resolveSessionDir`'s "latest" pick). */
  dirs: string[];
  /** Folder names sorted ahead of `dirs[0]` that have no session.json — skipped when picking
   * "latest" (see `skippedNewerSessionsNote`), newest first. */
  skippedNewer: string[];
}

/**
 * Every session folder directly under `base` that has a session.json, newest first (by the
 * recording time in the folder name, falling back to mtime for a renamed folder). A folder with
 * no session.json is not a session — Chrome's "Ask where to save each file" setting can leave one
 * behind empty (D1) — so it never counts as one, though a newer one still needs reporting (see
 * `skippedNewer`). Throws the same friendly errors `resolveSessionDir` did when `base` does not
 * exist or has no session folders at all — `list_sessions` and `get_session` want that error to
 * look identical to the one `process` already gives.
 */
export async function listSessionDirs(base: string): Promise<SessionDirs> {
  const entries = await readdir(base, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    throw new CliError(`No session directory given and ${base} does not exist (${error.code}). ${NO_SESSIONS_HINT}`);
  });

  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (names.length === 0) throw new CliError(`No session folders found in ${base}. ${NO_SESSIONS_HINT}`);

  const candidates: Candidate[] = await Promise.all(
    names.map(async (name) => {
      const hasSessionFile = await stat(path.join(base, name, "session.json")).then(
        () => true,
        () => false,
      );
      return {
        name,
        hasSessionFile,
        ...(fromSessionId(name) ?? { time: (await stat(path.join(base, name))).mtimeMs, sequence: 1, byName: false }),
      } satisfies Candidate;
    }),
  );
  // Newest first; the name breaks the remaining ties so the result is deterministic.
  candidates.sort((a, b) => b.time - a.time || b.sequence - a.sequence || b.name.localeCompare(a.name));

  const firstValid = candidates.findIndex((c) => c.hasSessionFile);
  if (firstValid === -1) {
    throw new CliError(
      `No session folder in ${base} has a session.json — they exist but are empty. ${ASK_WHERE_HINT} ${NO_SESSIONS_HINT}`,
    );
  }
  return {
    dirs: candidates.filter((c) => c.hasSessionFile).map((c) => path.join(base, c.name)),
    skippedNewer: candidates.slice(0, firstValid).map((c) => c.name),
  };
}

/**
 * Resolves the session directory `pointcast process` should read: the explicit argument if
 * given, else the latest session in `--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`.
 *
 * "Latest" comes from the folder name, which is the recording's start time. A folder's mtime
 * is not reliable: processing an older session writes words.json and session.md into it, which
 * makes it the "newest" folder, and a later plain `pointcast process` would silently redo the
 * old session. mtime is only the fallback for folders with other names.
 */
export async function resolveSessionDir(options: ResolveSessionDirOptions): Promise<ResolvedSessionDir> {
  if (options.explicit) return { dir: path.resolve(options.explicit), reason: "given as argument" };

  const base = resolveSessionsBase(options);
  const { dirs, skippedNewer } = await listSessionDirs(base);
  const latestName = path.basename(dirs[0]!);
  const reason = fromSessionId(latestName)
    ? `latest session in ${base} (by the recording time in its name)`
    : `most recently modified folder in ${base} (its name is not a session id)`;
  const note = skippedNewerSessionsNote(skippedNewer);
  return { dir: dirs[0]!, reason: note ? `${reason}. ${note}` : reason };
}
