import { truncate } from "./markdown";
import { NOTE_MAX_CHARS, type SessionFile, type WordsFile } from "./schema";

/**
 * Typed mode (D12): the user types a note for each gesture instead of speaking. These helpers
 * are shared by the extension (which stores the notes) and the renderers and the CLI (which read
 * them), so every reader agrees on what a typed session and a note are.
 */

/** C0 controls other than tab and line feed, and DEL: nothing a note needs, and they upset terminals. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * The note as stored: line endings as "\n", no control characters, trailing spaces of each line
 * and blank lines at both ends removed, at most NOTE_MAX_CHARS (cut with "…"). Undefined for
 * anything that is not a string or is blank, so "saved without a note" has one representation.
 * Not redacted (D12): it is what the user wrote about their app, not text read from the page.
 */
export function cleanNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return text === "" ? undefined : truncate(text, NOTE_MAX_CHARS);
}

/** A session whose requests were typed (SessionFile.inputMode); absent means voice. */
export function isTypedSession(session: Pick<SessionFile, "inputMode">): boolean {
  return session.inputMode === "typed";
}

/**
 * What a typed session renders with in place of words.json, which it does not have: nothing was
 * said. Readers that need a WordsFile (the CLI's summaries) use it too.
 */
export const TYPED_SESSION_WORDS: Readonly<WordsFile> = Object.freeze({
  schemaVersion: 1,
  engine: "none (typed session)",
  words: [],
});
