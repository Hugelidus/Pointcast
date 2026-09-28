import * as fsPromises from "node:fs/promises";
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { HandoffErrorCode, HandoffFile } from "@pointcast/core";
import { CliError } from "../errors";
import { validateSessionFile } from "../process/session-file";
import { validateWordsFile } from "../process/words-file";

/**
 * A delivery in progress is written into `<base>/.incoming-<random>` and renamed to `<base>/<id>`
 * only once complete (H6), so a reader never sees half a session. The leading "." matters:
 * discover.ts skips dot folders, which would otherwise be reported as a session folder with no
 * session.json, with the Ask-where hint.
 */
export const STAGING_PREFIX = ".incoming-";
/** A staging folder this old was left by a crash (an upload takes seconds); the next start removes it. */
const STALE_STAGING_MS = 60 * 60 * 1000;
/** Windows antivirus and the search indexer briefly lock a folder whose files were just written. */
const RENAME_RETRY_MS = 100;
const RENAME_RETRY_FOR_MS = 2_000;
const TRANSIENT_RENAME_ERRORS: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);
/** What rename reports on POSIX when the target is a folder that is not empty. */
const TARGET_EXISTS_ERRORS: ReadonlySet<string> = new Set(["EEXIST", "ENOTEMPTY"]);

export type StoreResult =
  | { status: 201; id: string; dir: string }
  | { status: 400 | 409 | 500; error: HandoffErrorCode; message: string };

export type StoreFs = Pick<typeof import("node:fs/promises"), "mkdir" | "mkdtemp" | "writeFile" | "rename" | "rm" | "lstat">;

export interface StoreInput {
  /** The sessions folder the MCP tools read (resolveSessionsBase). */
  base: string;
  /** Already checked by the receiver with isSessionId. */
  id: string;
  /** From X-Pointcast-Files, in the body's order. */
  files: readonly HandoffFile[];
  body: Buffer;
  /** True once the client has disconnected; checked right before the commit (H8). */
  clientGone?: () => boolean;
  /** Injected in tests to simulate EPERM on rename, ENOSPC on write. Defaults to node:fs/promises. */
  fs?: StoreFs;
  /** Injected in tests; defaults to process.platform. Only Windows retries a refused rename. */
  platform?: NodeJS.Platform;
}

const badRequest = (message: string): StoreResult => ({ status: 400, error: "bad-request", message });
const writeFailed = (message: string): StoreResult => ({ status: 500, error: "write-failed", message });
const exists = (id: string): StoreResult => ({ status: 409, error: "exists", message: `a session folder named ${id} already exists` });

/**
 * Stores a recording handed over by the extension as `<base>/<id>/`, exactly as Chrome's downloads
 * would have: the same files, byte for byte. Validates before writing anything, so a session the
 * tools could not read never lands in the folder they read; writes into a staging folder and
 * renames it, so readers never see half of one; and never overwrites (409): the extension then
 * falls back to Chrome's downloads, which is what already happens for a same-second id today.
 */
export async function storeSession(input: StoreInput): Promise<StoreResult> {
  const { base, id, files, body, fs = fsPromises, platform = process.platform } = input;

  let offset = 0;
  const parts = files.map((file) => {
    const bytes = body.subarray(offset, offset + file.size);
    offset += file.size;
    return { name: file.name, bytes };
  });
  if (offset !== body.length) return badRequest(`the body is ${body.length} bytes, not the ${offset} its file list adds up to`);

  const invalid = validateParts(id, parts);
  if (invalid !== undefined) return badRequest(invalid);

  // The receiver only passes ids matching SESSION_ID_PATTERN; this keeps the "one folder directly
  // in base" guarantee local to the code that writes, whatever a future caller passes.
  const root = path.resolve(base);
  const target = path.join(root, id);
  if (path.dirname(target) !== root) return badRequest("not a pointcast session id");

  let staging: string | undefined;
  try {
    await fs.mkdir(root, { recursive: true });
    staging = await fs.mkdtemp(path.join(root, STAGING_PREFIX));
    for (const part of parts) await fs.writeFile(path.join(staging, part.name), part.bytes, { flag: "wx" });

    // H8: nobody is waiting for the answer, and the extension has already fallen back to
    // Chrome's downloads, so committing would store the recording twice.
    if (input.clientGone?.()) {
      await discard(fs, staging);
      return writeFailed("the extension stopped waiting");
    }
    if ((await commit(fs, staging, target, platform)) === "exists") {
      await discard(fs, staging);
      return exists(id);
    }
    return { status: 201, id, dir: displayPath(target) };
  } catch (error) {
    if (staging !== undefined) await discard(fs, staging);
    return writeFailed(describeFsError(error));
  }
}

/** Why the files cannot be stored, or undefined. The same validators `process` and the tools use. */
function validateParts(id: string, parts: readonly { name: string; bytes: Buffer }[]): string | undefined {
  try {
    for (const { name, bytes } of parts) {
      if (name === "session.json") {
        const session = validateSessionFile(parseJson(name, bytes), name);
        if (session.id !== id) return `session.json's id ${JSON.stringify(session.id)} is not the ${id} in the URL`;
      } else if (name === "words.json") {
        validateWordsFile(parseJson(name, bytes), name);
      } else if (name === "session.md") {
        decodeUtf8(name, bytes);
      }
      // Audio is never agent input, and the CLI's WAV reader validates it when it is used (H11).
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    // The validators write sentences; the extension shows this inside "(…)" (core handoff.ts).
    return error.message.replace(/\.$/, "");
  }
}

function decodeUtf8(name: string, bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CliError(`${name} is not valid UTF-8`);
  }
}

function parseJson(name: string, bytes: Buffer): unknown {
  const text = decodeUtf8(name, bytes);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new CliError(`${name} is not valid JSON: ${(cause as Error).message}`);
  }
}

/**
 * Renames the staging folder to the target, unless the target exists. The lstat comes first
 * because on POSIX a rename replaces an empty folder, such as one Chrome's Ask-where dialog left.
 */
async function commit(fs: StoreFs, staging: string, target: string, platform: NodeJS.Platform): Promise<"stored" | "exists"> {
  const deadline = Date.now() + RENAME_RETRY_FOR_MS;
  for (;;) {
    if (await pathExists(fs, target)) return "exists";
    try {
      await fs.rename(staging, target);
      return "stored";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (TARGET_EXISTS_ERRORS.has(code)) return "exists";
      // Windows also answers EPERM when the target exists: the lstat above tells the two apart.
      if (platform !== "win32" || !TRANSIENT_RENAME_ERRORS.has(code) || Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS));
  }
}

async function pathExists(fs: Pick<StoreFs, "lstat">, target: string): Promise<boolean> {
  return fs.lstat(target).then(
    () => true,
    () => false,
  );
}

/** Best effort: a leftover is a dot folder that readers skip and the next start sweeps. */
async function discard(fs: StoreFs, staging: string): Promise<void> {
  await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
}

/**
 * "ENOSPC: no space left on device". Node's own message goes on with the syscall and the full
 * path, which would put the OS user name in the popup's storage (D8); the code says enough.
 */
function describeFsError(error: unknown): string {
  const { code, message } = error as NodeJS.ErrnoException;
  const description = String(message).split(", ")[0]!;
  return code === undefined || description.startsWith(`${code}:`) ? description : `${code}: ${description}`;
}

/** For the receiver's early 409, before it reads a body it would then refuse. */
export async function sessionFolderExists(base: string, id: string): Promise<boolean> {
  return pathExists({ lstat }, path.join(base, id));
}

/** Removes staging folders a crash left behind. Never throws: it runs unattended at start. */
export async function sweepStaging(base: string, now: number = Date.now()): Promise<void> {
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  await Promise.allSettled(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX))
      .map(async (entry) => {
        const folder = path.join(base, entry.name);
        if (now - (await stat(folder)).mtimeMs > STALE_STAGING_MS) await rm(folder, { recursive: true, force: true });
      }),
  );
}

/**
 * The path with the home folder shown as "~", e.g. "~\Downloads\pointcast\2026-09-28_10-15-00"
 * (H12). The popup keeps it in storage.session, which content scripts on enabled sites can read,
 * so the OS user name must not be in it (D8). A path outside the home folder can hold it too (a
 * Downloads folder moved to D:\Users\<name>\Downloads, POINTCAST_DIR=D:\work\<name>\pointcast), so
 * it is cut to its last two segments, the sessions folder and the session: "…\pointcast\<id>".
 * The path flavor follows `home`, so both are testable on any OS; Windows paths compare
 * case-insensitively.
 */
export function displayPath(absolute: string, home: string = homedir()): string {
  const flavor = /^[A-Za-z]:[\\/]|^\\\\/.test(home) ? path.win32 : path.posix;
  const relative = flavor.relative(home, absolute);
  if (relative === "") return "~";
  const outside = relative === ".." || relative.startsWith(`..${flavor.sep}`) || flavor.isAbsolute(relative);
  if (!outside) return `~${flavor.sep}${relative}`;
  // Drive letters ("D:") and UNC roots are dropped with the rest of the prefix.
  const segments = flavor
    .normalize(absolute)
    .split(/[\\/]/)
    .filter((segment) => segment !== "" && !/^[A-Za-z]:$/.test(segment));
  return ["…", ...segments.slice(-2)].join(flavor.sep);
}
