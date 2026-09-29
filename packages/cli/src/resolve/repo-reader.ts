import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceReader } from "@pointcast/core";

/**
 * Route 1 (local repo): core's resolver reads the files a recording's code chain names
 * ("src/lib/More.svelte", project-relative) through a SourceReader. This one reads them from a
 * project folder on disk.
 *
 * The chain's paths are relative to the app the dev server served, which in a monorepo is a
 * package ("apps/web"), not the repository root. So a path missing at the root is looked up by
 * unique path suffix ("apps/web/src/lib/More.svelte" ends with "/src/lib/More.svelte") in a
 * bounded scan. Two matches means nothing: a wrong file is worse than none.
 */

/** A reader that can also say where it found a file, relative to its root, for links. */
export interface LocatingReader extends SourceReader {
  /** The root-relative path (forward slashes) the file was found at, or undefined. */
  locate(file: string): Promise<string | undefined>;
}

/** Folders never scanned: dependencies, VCS data and build output hold copies, not sources. */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build", ".next", ".svelte-kit"]);

/** Files listed at most, so pointing it at a home folder by mistake stays cheap. */
export const MAX_SCANNED_FILES = 50_000;

/**
 * A project-relative path, forward slashes, without a leading "./" or "/"; undefined for
 * anything that could leave the root ("..", a drive letter, a URL scheme). A session can come
 * from someone else, and its paths are page-controlled dev data.
 */
export function normalizeProjectPath(file: string): string | undefined {
  const clean = file.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
  if (clean === "" || clean.includes("\0") || /^[a-z][a-z\d+.-]*:/i.test(clean)) return undefined;
  return clean.split("/").some((segment) => segment === ".." || segment === "") ? undefined : clean;
}

/** The one listed file equal to `wanted` or ending with "/wanted"; undefined for none or several. */
export function uniqueSuffixMatch(files: Iterable<string>, wanted: string): string | undefined {
  let found: string | undefined;
  for (const file of files) {
    if (file !== wanted && !file.endsWith(`/${wanted}`)) continue;
    if (found !== undefined) return undefined;
    found = file;
  }
  return found;
}

export function createRepoReader(root: string, options: { maxFiles?: number } = {}): LocatingReader {
  const maxFiles = options.maxFiles ?? MAX_SCANNED_FILES;
  // One scan per reader, only when a path is missing at the root. A reader lives for one
  // command or one MCP tool call, so the list never goes stale while the agent edits files.
  let fileList: Promise<string[]> | undefined;
  const located = new Map<string, Promise<string | undefined>>();

  async function find(file: string): Promise<string | undefined> {
    const wanted = normalizeProjectPath(file);
    if (wanted === undefined) return undefined;
    if (await isFile(path.join(root, wanted))) return wanted;
    fileList ??= listFiles(root, maxFiles);
    return uniqueSuffixMatch(await fileList, wanted);
  }

  const locate = (file: string): Promise<string | undefined> => {
    let result = located.get(file);
    if (result === undefined) {
      result = find(file);
      located.set(file, result);
    }
    return result;
  };

  return {
    locate,
    async read(file) {
      const found = await locate(file);
      return found === undefined ? undefined : readFile(path.join(root, found), "utf8").catch(() => undefined);
    },
  };
}

/**
 * The folder, relative to `root` and ending in "/", that a session's paths are relative to when
 * that is not `root` itself (D9 note 2026-09-28, pass 2): the dev server served an app in a
 * subfolder of the repository the agent works in ("web/" in a repo whose Vite app is
 * `web/`), so `src/…` in the spec does not exist from the agent's folder. Found by matching
 * all the session's paths at once: the one folder under which every path that exists anywhere
 * exists. "" when they all exist at `root` (or none exists anywhere), and undefined when no
 * single folder holds them all, or several do (two apps with the same files): then the paths
 * stay as they are. Reads the same bounded file list as the reader's suffix lookup.
 */
export async function appFolderOf(root: string, files: readonly string[], options: { maxFiles?: number } = {}): Promise<string | undefined> {
  const wanted = [...new Set(files.flatMap((file) => normalizeProjectPath(file) ?? []))];
  if (wanted.length === 0) return "";
  const atRoot = await Promise.all(wanted.map((file) => isFile(path.join(root, file))));
  if (atRoot.every(Boolean)) return "";
  if (atRoot.some(Boolean)) return undefined;
  const listed = await listFiles(root, options.maxFiles ?? MAX_SCANNED_FILES);
  let candidates: Set<string> | undefined;
  for (const file of wanted) {
    const folders = new Set(listed.filter((found) => found.endsWith(`/${file}`)).map((found) => found.slice(0, -file.length)));
    if (folders.size === 0) continue;
    candidates = candidates === undefined ? folders : new Set([...candidates].filter((folder) => folders.has(folder)));
  }
  if (candidates === undefined) return "";
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    (s) => s.isFile(),
    () => false,
  );
}

/**
 * Root-relative paths of the files under `root`, breadth first (so the bound cuts deep folders,
 * not the top of the project), skipping SKIPPED_DIRS and symlinks (no cycles).
 */
async function listFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length > 0 && files.length < maxFiles) {
    const dir = queue.shift()!;
    const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) queue.push(relative);
      } else if (entry.isFile()) {
        files.push(relative);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}
