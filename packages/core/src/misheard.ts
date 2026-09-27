import { normalizeWord } from "./deictics";
import type { Word } from "./schema";
import { splitWord } from "./word-text";

/**
 * Speech recognition mangles UI names it does not know: the user says "API token" and Whisper
 * writes "app y token". The element's own text is right there, so a phrase near the gesture
 * that is *almost* that text is most likely a mishearing of it, and telling the agent saves it
 * from searching the codebase for "app y token".
 */

/** How far from the anchor word a phrase is considered, in words. */
const RADIUS = 6;
/** Longest phrase tried, in words ("app y token" is 3). */
const MAX_WORDS = 4;
/** Shortest compared form: shorter words match too much by chance. */
const MIN_LENGTH = 4;
/** Longest element text worth comparing: labels, not paragraphs. */
const MAX_TARGET_LENGTH = 40;
/** Minimum similarity, 1 - editDistance / longerLength. "appytoken" vs "apitoken" is 0.78. */
const MIN_SIMILARITY = 0.7;

export interface Misheard {
  /** The words as transcribed, e.g. "app y token". */
  heard: string;
  /** The element text or label it probably was, e.g. "API token". */
  meant: string;
}

/**
 * The phrase within [from, to) and RADIUS words of `anchor` most similar to one of `targets`
 * (the element's text and label), when similar enough but not the same. Phrases are compared
 * with case, accents, punctuation and spaces removed, so word splits do not matter.
 * A phrase that contains the target or is contained in it ("exportar" vs "Export") is the
 * user talking about the element correctly, not a mishearing, so it is skipped.
 */
export function findMisheard(
  words: readonly Word[],
  anchor: number,
  from: number,
  to: number,
  targets: readonly string[],
): Misheard | undefined {
  const usable = targets
    .map((text) => ({ text: text.trim(), form: normalizeWord(text) }))
    .filter((t) => t.form.length >= MIN_LENGTH && t.text.length <= MAX_TARGET_LENGTH);
  if (usable.length === 0) return undefined;

  const start = Math.max(from, anchor - RADIUS);
  const end = Math.min(to, anchor + RADIUS + 1);
  let best: (Misheard & { score: number }) | undefined;
  for (let i = start; i < end; i++) {
    for (let n = 1; n <= MAX_WORDS && i + n <= end; n++) {
      const phrase = words.slice(i, i + n);
      const form = phrase.map((w) => normalizeWord(w.text)).join("");
      if (form.length < MIN_LENGTH) continue;
      for (const target of usable) {
        if (form.includes(target.form) || target.form.includes(form)) continue;
        const score = similarity(form, target.form);
        // Strictly better only: on a tie the shorter, earlier phrase wins.
        if (score >= MIN_SIMILARITY && (!best || score > best.score)) {
          const heard = phrase.map((w) => splitWord(w.text).core).join(" ");
          best = { heard, meant: target.text, score };
        }
      }
    }
  }
  return best && { heard: best.heard, meant: best.meant };
}

function similarity(a: string, b: string): number {
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** Levenshtein distance, one row at a time. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length];
}
