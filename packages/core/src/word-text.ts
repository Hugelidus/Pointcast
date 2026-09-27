import type { Word } from "./schema";

/** A word token split so a marker can go after the word but before its punctuation. */
export interface WordParts {
  /** " " when the token had leading whitespace, else "". */
  lead: string;
  /** The word itself, e.g. "Esto" in " Esto,". */
  core: string;
  /** Trailing punctuation, e.g. "," in " Esto,". Empty for punctuation-only tokens. */
  trailing: string;
}

/**
 * Split an engine token such as " Esto," into lead " ", core "Esto", trailing ",".
 * Why: "Esto *[marker]*," reads naturally, while "Esto, *[marker]*" makes the marker look
 * like it belongs to the next clause.
 */
export function splitWord(text: string): WordParts {
  const lead = /^\s/.test(text) ? " " : "";
  const body = text.trim();
  const match = /^(.*?[^\p{P}])(\p{P}+)$/su.exec(body);
  if (!match) return { lead, core: body, trailing: "" };
  return { lead, core: match[1], trailing: match[2] };
}

/**
 * Whisper (transformers.js) marks word starts with a leading space (" Esto", " me") and glues
 * sub-word pieces without one. Other engines (OpenAI-compatible APIs) return bare words.
 * When no token after the first has leading whitespace we assume bare words and join them
 * with spaces; otherwise we trust the leading spaces as given.
 */
export function usesLeadingSpaces(words: readonly Word[]): boolean {
  return words.some((word, index) => index > 0 && /^\s/.test(word.text));
}

/** True for tokens made only of punctuation, such as "," or "..." (never preceded by a space). */
export function isPunctuationOnly(text: string): boolean {
  return /^\p{P}+$/u.test(text.trim());
}
