import { stat } from "node:fs/promises";
import { cachingReader, projectMatch, resolveSession, type SessionFile } from "@pointcast/core";
import { CliError } from "../errors";
import { createRepoReader } from "./repo-reader";

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
  const reader = cachingReader(createRepoReader(root));
  const match = await projectMatch(session, reader);
  if (match.matches === undefined) return { status: "no-chain", session, root };
  if (!match.matches) return { status: "mismatch", session, root, files: match.files };

  const resolved = await resolveSession(session, reader, "repo");
  const found = resolved.events.reduce((sum, event) => sum + (event.element.resolved?.length ?? 0), 0);
  return { status: "resolved", session: resolved, root, found };
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
