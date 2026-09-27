import type { Word } from "./schema";

/** Sentence end: ".", "!", "?" or "…", optionally followed by closing quotes or brackets. */
export const SENTENCE_END = /[.!?…]["'»”’)\]]*$/u;

/** Words [from, to) of one sentence. */
export interface Sentence {
  from: number;
  to: number;
}

/**
 * Split a transcript into sentences. Whisper punctuates, so a word ending in ".", "!", "?" or
 * "…" closes a sentence. A pause of at least `pauseMs` closes one too: engines that do not
 * punctuate (or a run-on without a period) still get split where the speaker stopped.
 */
export function splitSentences(words: readonly Word[], pauseMs: number): Sentence[] {
  const sentences: Sentence[] = [];
  let from = 0;
  for (let k = 0; k < words.length; k++) {
    const last = k === words.length - 1;
    const ends =
      last ||
      SENTENCE_END.test(words[k].text.trimEnd()) ||
      words[k + 1].start - words[k].end >= pauseMs;
    if (ends) {
      sentences.push({ from, to: k + 1 });
      from = k + 1;
    }
  }
  return sentences;
}
