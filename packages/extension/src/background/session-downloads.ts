import { browser } from "wxt/browser";
import { SESSIONS_FOLDER } from "@pointcast/core";
import type { SessionFileUrl } from "../messages";

/** Downloads/pointcast/<session-id>/<file>: extensions can only write inside Downloads (D6). */
export function sessionFilePath(sessionId: string, fileName: string): string {
  return `${SESSIONS_FOLDER}/${sessionId}/${fileName}`;
}

/** Starts every download and returns their ids, in order; completion is tracked through downloads.onChanged. */
export async function startSessionDownloads(sessionId: string, files: readonly SessionFileUrl[]): Promise<number[]> {
  const download = ({ url, fileName }: SessionFileUrl) =>
    browser.downloads.download({
      url,
      filename: sessionFilePath(sessionId, fileName),
      // Never ask where to save, even if the user enabled "Ask where to save each file":
      // the CLI finds sessions by their fixed location.
      saveAs: false,
      // Never overwrite a user's file. Session ids are chosen to be free (sessionIdsInHistory),
      // so this only matters if the history was cleared while the folder still exists.
      conflictAction: "uniquify",
    });
  return Promise.all(files.map(download));
}

/**
 * Session folders starting with `base` that downloads already wrote to ("base", "base-2", …),
 * read from Chrome's downloads history. Chrome reports absolute paths with the OS separator.
 */
export async function sessionIdsInHistory(base: string): Promise<Set<string>> {
  const idPattern = `${base}(?:-[0-9]+)?`;
  const items = await browser.downloads.search({ filenameRegex: `[\\\\/]${SESSIONS_FOLDER}[\\\\/]${idPattern}[\\\\/]` });
  const extract = new RegExp(`[\\\\/]${SESSIONS_FOLDER}[\\\\/](${idPattern})[\\\\/]`);
  const ids = new Set<string>();
  for (const item of items) {
    const match = extract.exec(item.filename);
    if (match?.[1] !== undefined) ids.add(match[1]);
  }
  return ids;
}

export type DownloadsOutcome = "in-progress" | "complete" | "failed";

/**
 * "Turn off ... chrome://settings/downloads, or keep ... MCP server running ...", reused by every
 * message that traces back to Chrome's "Ask where to save each file before downloading" setting:
 * it makes `downloads.download({ saveAs: false })` pop a Save dialog for every file anyway, so a
 * file can land wherever the dialog was pointed, or the download can be cancelled outright. A
 * running pointcast MCP server avoids Chrome's downloads, and so the dialogs, altogether (D11).
 */
export function turnOffAskWhereAdvice(): string {
  return (
    'Turn off "Ask where to save each file before downloading" in chrome://settings/downloads, or keep your ' +
    "coding agent's pointcast MCP server running (with \"Send to a running pointcast MCP server\" on in Settings): " +
    "recordings then skip Chrome's downloads."
  );
}

/** Chrome reported saving `filename` inside its own session folder — either OS separator. */
function isInSessionFolder(filename: string, sessionId: string): boolean {
  return new RegExp(`[\\\\/]${SESSIONS_FOLDER}[\\\\/]${sessionId}[\\\\/]`).test(filename);
}

export interface DownloadsCheck {
  outcome: DownloadsOutcome;
  /**
   * Set when `outcome` is "complete" and at least one file is not inside Downloads/pointcast/
   * <sessionId>/: the session is still saved (the download ids still work for "Show in folder"),
   * but it is not where `pointcast process` and the MCP server look for it.
   */
  warning?: string;
  /** Set when `outcome` is "failed" and Chrome reports why, e.g. "USER_CANCELED" for a save
   * dialog the user closed without choosing a file. */
  error?: string;
}

/**
 * Asks Chrome for the current state of every download in a session instead of tracking it in
 * memory, and — once they are all done — whether Chrome actually saved them where they belong.
 */
export async function checkDownloads(sessionId: string, ids: readonly number[]): Promise<DownloadsCheck> {
  const items = await Promise.all(ids.map(async (id) => (await browser.downloads.search({ id }))[0]));
  if (items.some((item) => item?.state === "in_progress")) return { outcome: "in-progress" };

  const interrupted = items.find((item) => item?.state === "interrupted");
  // A missing item was erased from the history by the user after it finished: not a failure.
  if (interrupted) return { outcome: "failed", ...(interrupted.error ? { error: interrupted.error } : {}) };

  // A missing item says nothing about where it was saved: only files Chrome still lists count.
  if (items.every((item) => item === undefined || isInSessionFolder(item.filename, sessionId))) {
    return { outcome: "complete" };
  }
  return {
    outcome: "complete",
    warning:
      `Chrome asked where to save each file, so this session is not in Downloads/${SESSIONS_FOLDER}/${sessionId}/, ` +
      `where "pointcast process" and the MCP server look for it. ${turnOffAskWhereAdvice()}`,
  };
}
