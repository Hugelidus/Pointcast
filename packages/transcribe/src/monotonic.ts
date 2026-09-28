import type { Word } from "@pointcast/core";

/**
 * Removes words that an engine re-emitted for audio it had already transcribed, so the result
 * moves forward in time.
 *
 * Why: transformers.js transcribes audio longer than 30 s in overlapping chunks, and with
 * word-level timestamps it does not always merge the overlap. On dev/fixtures/audio/es-2min.wav it
 * emitted "…por ejemplo por cliente," and then the same 12 words again, with the same times,
 * starting 3.7 s earlier. Fusion (packages/core) assumes time-ordered words: a repeated span
 * duplicates sentences in session.md, adds a second copy of every deictic in it, and makes
 * gaps between words negative.
 *
 * Rule: a word that starts before the previous kept word *starts* is a re-emission (time never
 * goes backwards in speech), and so is every following word that starts before the previous
 * kept word *ends*, until the transcript catches up. Outside such a span a small overlap (a
 * word starting a little before the previous one ends) is normal engine jitter and is kept.
 */
export function dropReemittedWords(words: readonly Word[]): Word[] {
  const kept: Word[] = [];
  let skipping = false;
  for (const word of words) {
    const last = kept.at(-1);
    if (last !== undefined) {
      if (word.start < last.start) skipping = true;
      if (skipping && word.start < last.end) continue;
    }
    skipping = false;
    kept.push(word);
  }
  return kept;
}
