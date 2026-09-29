import { stat } from "node:fs/promises";
import path from "node:path";
import { cachingReader, isLibraryPath, projectMatch, resolveSession, type ElementInfo, type SessionFile } from "@pointcast/core";
import { CliError } from "../errors";
import { appFolderOf, createRepoReader, normalizeProjectPath } from "./repo-reader";

/**
 * Route 1: resolve a session's code pointers against a project folder on disk, for
 * `pointcast process` and the MCP tools. Stage 0 (docs/eval/stage0-code-pointer-2026-09-27.md)
 * found the chain alone can send an agent to the shared component; the resolved `text at:` line
 * is what fixed it, and it needs the source, which only exists where the CLI runs.
 */
export type LocalResolution =
  /** Resolution ran; `found` locations were added (0 is possible: silence beats a guess). */
  | { status: "resolved"; session: SessionFile; root: string; found: number }
  /** The recording names no source files (no renderedBy: production build or older session). */
  | { status: "no-chain"; session: SessionFile; root: string }
  /** It names files and none is under `root`: probably recorded on another project. */
  | { status: "mismatch"; session: SessionFile; root: string; files: string[] };

/**
 * `explicit`: the folder was named by the user (--repo, the MCP "repo" argument), so a folder
 * that does not exist is their mistake and an error. A default folder (the current directory)
 * is only ever a guess, so it never fails the command.
 */
export async function resolveWithRepo(
  session: SessionFile,
  root: string,
  options: { explicit: boolean },
): Promise<LocalResolution> {
  const isDir = await stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDir && options.explicit) throw new CliError(`The project folder ${root} does not exist or is not a folder.`);

  // One cache for both passes: projectMatch and resolveSession read the same chain files.
  const atRoot = cachingReader(createRepoReader(root));
  const match = await projectMatch(session, atRoot);
  if (match.matches === undefined) return { status: "no-chain", session, root };
  if (!match.matches) return { status: "mismatch", session, root, files: match.files };

  // The app may be a subfolder of the folder the agent works in (appFolderOf): its paths are then
  // read there, and shown from `root`, so every path in the spec opens as written.
  const folder = await appFolderOf(root, match.files);
  const reader = folder ? cachingReader(createRepoReader(path.join(root, folder))) : atRoot;
  const resolved = await resolveSession(session, reader, "repo");
  const found = resolved.events.reduce((sum, event) => sum + (event.element.resolved?.length ?? 0), 0);
  return { status: "resolved", session: folder ? withFolder(resolved, folder) : resolved, root, found };
}

/**
 * The session with every app path the spec shows prefixed by `folder` ("web/"): the chain's
 * frames, the element's component and source attribute, and the resolved and shown-by lines, in
 * `used at`, `within`, `defined in`, `text at`/`data at`, `shown by`, `find:` and get_element
 * alike. Library paths and anything not a plain relative path are left as they are.
 */
export function withFolder(session: SessionFile, folder: string): SessionFile {
  const prefix = (file: unknown): unknown => {
    if (typeof file !== "string" || isLibraryPath(file)) return file;
    const clean = normalizeProjectPath(file);
    return clean === undefined ? file : `${folder}${clean}`;
  };
  const inElement = (element: ElementInfo): ElementInfo => {
    const out: ElementInfo = { ...element };
    if (Array.isArray(element.renderedBy)) out.renderedBy = element.renderedBy.map((frame) => ({ ...frame, file: prefix(frame.file) as string }));
    if (element.component && typeof element.component === "object") out.component = { ...element.component, ...(element.component.file === undefined ? {} : { file: prefix(element.component.file) as string }) };
    if (element.source && typeof element.source === "object") out.source = { ...element.source, file: prefix(element.source.file) as string };
    if (Array.isArray(element.resolved)) out.resolved = element.resolved.map((location) => ({ ...location, file: prefix(location.file) as string }));
    if (element.shownBy && typeof element.shownBy === "object") out.shownBy = { ...element.shownBy, file: prefix(element.shownBy.file) as string };
    return out;
  };
  return { ...session, events: session.events.map((event) => ({ ...event, element: inElement(event.element) })) };
}

/** One stderr line for `pointcast process`: what was resolved, or why nothing was. */
export function describeResolution(result: LocalResolution, options: { explicit: boolean }): string {
  switch (result.status) {
    case "resolved":
      return `code locations: ${result.found} found in ${result.root}`;
    case "no-chain":
      return "code locations: none to resolve (the recording has no component chain; it is only captured from dev builds)";
    case "mismatch":
      return (
        `code locations: not resolved, none of the recording's source files (${exampleFiles(result.files)}) is in ${result.root}` +
        (options.explicit ? "; was it recorded on another project?" : `; pass --repo <project folder>`)
      );
  }
}

/** One line for the top of a spec the MCP server returns, when the project looks wrong. */
export function mismatchWarning(result: Extract<LocalResolution, { status: "mismatch" }>): string {
  return (
    `> **Warning:** none of the source files this recording points at (${exampleFiles(result.files)}) exists in ` +
    `\`${result.root}\`, so it was probably recorded on another project. Check before editing, or pass "repo" with the right project folder.`
  );
}

function exampleFiles(files: readonly string[]): string {
  const shown = files.slice(0, 2).map((file) => `\`${file}\``);
  return files.length > 2 ? `${shown.join(", ")}, …` : shown.join(", ");
}
