import { readFileSync } from "node:fs";

/** A word of a TTS fixture and when SAPI started saying it, in ms from the start of the WAV. */
export interface SpokenWord {
  text: string;
  startMs: number;
}

interface GroundTruthFile {
  text: string;
  words: SpokenWord[];
}

/** Lowercase, no accents, no punctuation: "Esto," and "esto" are the same word. */
export function normalize(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/**
 * Words of a fixtures/audio/*.words.json file in spoken order.
 *
 * Words are spoken in order, so their start times must increase. An earlier version of
 * scripts/tts/generate.ps1 sorted SAPI's events by an unstable key and paired words with other
 * words' times; the generator now checks this itself, and this check makes sure a stale or
 * hand-edited file can never silently schedule gestures at the wrong moments.
 */
export function readSpokenWords(file: string): SpokenWord[] {
  const truth = JSON.parse(readFileSync(file, "utf8")) as GroundTruthFile;
  truth.words.forEach((w, i) => {
    const previous = truth.words[i - 1];
    if (previous !== undefined && w.startMs <= previous.startMs) {
      throw new Error(`${file}: word ${i} ("${w.text}") starts before the previous word; regenerate it with scripts/tts/generate.ps1`);
    }
  });
  return truth.words;
}

/** Start times of every occurrence of `word` (compared after normalizing). */
export function startsOf(words: readonly SpokenWord[], word: string): number[] {
  const wanted = normalize(word);
  return words.filter((w) => normalize(w.text) === wanted).map((w) => w.startMs);
}
