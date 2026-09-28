import { intervalGap, normalizeWord, type TimeSpan, type Word } from "@pointcast/core";

/**
 * Last line of defence against Whisper's degenerate output (D1 note 2026-09-28). The VAD keeps
 * silence away from Whisper (speech.ts), but Whisper can still loop inside speech, or on a noise
 * the VAD took for speech. Real cases this was written for, from a user's report and reproduced:
 * "de la" ×430 in a 19.2 s recording with times up to 29.8 s and a last word ending at 0;
 * "Por favor, vengan a la vida." ×9 over 15 s of silence; "¡Adiós!" at 16.34-29.98 s in a 20 s
 * file; "Gracias." alone on silence.
 *
 * Each rule removes only what speech cannot produce, so a normal transcript comes out unchanged.
 * Pure: the engine calls it on each transcription (and each live piece), tests call it on
 * recorded bad output.
 */

export interface SanitizeOptions {
  /** Length of the transcribed audio, in ms; words must lie within it. */
  durationMs: number;
  /**
   * Where the VAD heard speech, in ms, without padding. Undefined when the VAD was not available:
   * then no word is dropped for lying outside speech.
   */
  speech?: readonly TimeSpan[];
}

export interface Sanitized {
  words: Word[];
  /** Stretches where the transcript degenerated and something was dropped (WordsFile.unreliable). */
  unreliable: TimeSpan[];
}

/** Whisper's timestamps have 20 ms steps: a last word may end a step after the audio. */
const END_TOLERANCE_MS = 20;
/**
 * Two words in a row can share a time in fast speech ("de la" at the same 20 ms step), three
 * or more mean the timestamps have given up: the output is looping or invented.
 */
const MIN_ZERO_RUN = 3;
/** A phrase said three times in a row is collapsed to once… */
const MIN_REPEATS = 3;
/** …phrases up to this many words ("Por favor, vengan a la vida." is 6). */
const MAX_PHRASE_WORDS = 12;
/**
 * "no, no, no" is something people say: collapsing it loses nothing worth a warning. A longer
 * phrase repeated three times, or anything repeated four times or more, is Whisper looping.
 */
const WARN_REPEATS_SINGLE_WORD = 4;
/** Unreliable stretches closer than this are reported as one. */
const MERGE_GAP_MS = 1000;
/**
 * A phrase from KNOWN_HALLUCINATIONS is dropped only when it lies at least this far from any
 * speech the VAD heard. Whisper's word times run late at the end of a phrase: the real
 * "Gracias." closing fixtures/audio/es-2min.wav (said at 150.85 s) is timed 151.19-151.79 s,
 * mostly after the VAD's speech ends, and a rule based on overlap alone dropped it.
 */
const SPEECH_TOLERANCE_MS = 500;

/**
 * What Whisper says on silence, from its subtitle-heavy training data (the openai/whisper
 * discussions list the same ones), normalized like normalizeWord. Only dropped where the VAD
 * heard no speech, so a real "gracias" stays.
 */
const KNOWN_HALLUCINATIONS: readonly string[][] = [
  "gracias",
  "muchas gracias",
  "gracias por ver",
  "gracias por ver el video",
  "adios",
  "hasta la proxima",
  "suscribete",
  "subtitulos realizados por la comunidad de amaraorg",
  "subtitulos por la comunidad de amaraorg",
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "thank you very much",
  "bye",
  "you",
  "merci",
  "sous titres realises par la communaute damaraorg",
  "vielen dank",
  "untertitel der amaraorg community",
  "untertitel im auftrag des zdf",
  "obrigado",
  "obrigada",
  "grazie",
].map((phrase) => phrase.split(" "));

export function sanitizeWords(words: readonly Word[], options: SanitizeOptions): Sanitized {
  const unreliable: TimeSpan[] = [];
  let kept = words.filter((word) => word.start >= 0 && word.end >= word.start && word.end <= options.durationMs + END_TOLERANCE_MS);
  kept = dropZeroDurationRuns(kept, unreliable);
  if (options.speech) kept = dropHallucinationsOutsideSpeech(kept, options.speech);
  kept = collapseRepeats(kept, unreliable);
  return { words: kept, unreliable: mergeSpans(unreliable) };
}

function dropZeroDurationRuns(words: readonly Word[], unreliable: TimeSpan[]): Word[] {
  const kept: Word[] = [];
  let i = 0;
  while (i < words.length) {
    // [i, runEnd) is the run of zero-duration words starting at i (empty if word i has a duration).
    let runEnd = i;
    while (runEnd < words.length && words[runEnd]!.end === words[runEnd]!.start) runEnd++;
    if (runEnd - i >= MIN_ZERO_RUN) {
      unreliable.push({ start: words[i]!.start, end: words[runEnd - 1]!.end });
    } else {
      runEnd = Math.max(runEnd, i + 1);
      kept.push(...words.slice(i, runEnd));
    }
    i = runEnd;
  }
  return kept;
}

function dropHallucinationsOutsideSpeech(words: readonly Word[], speech: readonly TimeSpan[]): Word[] {
  const text = words.map((word) => normalizeWord(word.text));
  const drop = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    for (const phrase of KNOWN_HALLUCINATIONS) {
      if (!phrase.every((part, k) => text[i + k] === part)) continue;
      const start = words[i]!.start;
      const end = words[i + phrase.length - 1]!.end;
      const nearSpeech = speech.some((s) => intervalGap(start, end, s.start, s.end) < SPEECH_TOLERANCE_MS);
      if (!nearSpeech) for (let k = 0; k < phrase.length; k++) drop.add(i + k);
    }
  }
  return words.filter((_, index) => !drop.has(index));
}

/**
 * A phrase repeated MIN_REPEATS times or more in a row is kept once. Words are compared
 * normalized, so "de la, de la." is a repeat. At each position the longest repeated run wins
 * (the shortest phrase on a tie), so "de la de la de la" is one run of "de la", not of "de".
 */
function collapseRepeats(words: readonly Word[], unreliable: TimeSpan[]): Word[] {
  const text = words.map((word) => normalizeWord(word.text));
  const same = (a: number, b: number, length: number) => {
    for (let k = 0; k < length; k++) if (text[a + k] !== text[b + k]) return false;
    return true;
  };
  const kept: Word[] = [];
  let i = 0;
  while (i < words.length) {
    let best = { length: 1, repeats: 1 };
    for (let length = 1; length <= MAX_PHRASE_WORDS && i + length * MIN_REPEATS <= words.length; length++) {
      let repeats = 1;
      while (i + (repeats + 1) * length <= words.length && same(i, i + repeats * length, length)) repeats++;
      if (repeats >= MIN_REPEATS && repeats * length > best.repeats * best.length) best = { length, repeats };
    }
    kept.push(...words.slice(i, i + best.length));
    const fullCopiesEnd = i + best.repeats * best.length;
    let runEnd = fullCopiesEnd;
    if (best.repeats >= MIN_REPEATS) {
      // A loop usually stops in the middle of a copy ("de la de la de"): that part goes too.
      const partOfCopy = (at: number) => at - fullCopiesEnd < best.length && text[at] === text[i + at - fullCopiesEnd];
      while (runEnd < words.length && partOfCopy(runEnd)) runEnd++;
      if (best.length > 1 || best.repeats >= WARN_REPEATS_SINGLE_WORD) {
        unreliable.push({ start: words[i]!.start, end: words[runEnd - 1]!.end });
      }
    }
    i = runEnd;
  }
  return kept;
}

function mergeSpans(spans: readonly TimeSpan[]): TimeSpan[] {
  const merged: TimeSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && span.start - last.end < MERGE_GAP_MS) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
