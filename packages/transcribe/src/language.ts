import { TranscriptionError } from "./errors";

/**
 * Helpers for spoken-language detection with the local Whisper engine.
 *
 * Why this exists: transformers.js does not detect the language. With no language it logs
 * "No language specified - defaulting to English" and transcribes as English, so a Spanish
 * recording came out as an invented English sentence, which was then cached in words.json.
 * Whisper itself can tell the language: after the start-of-transcript token its first
 * prediction is a language token. We score those tokens once on the first 30 s of speech.
 */

/** Below this confidence the engine asks for the language instead of guessing (a wrong guess is
 * worse than a question: the transcript is fluent nonsense and nothing flags it). */
export const MIN_LANGUAGE_PROBABILITY = 0.8;

export interface LanguageGuess {
  /** ISO 639-1 code, e.g. "es". */
  code: string;
  /** Softmax over the language tokens only, in [0, 1]. */
  probability: number;
}

/**
 * Picks the most likely language from the decoder's logits for each language token
 * (keys look like "<|es|>"). The softmax runs over the language tokens only, so the
 * probability says how sure the model is between languages, not versus other text.
 */
export function pickLanguage(logitsByToken: ReadonlyMap<string, number>): LanguageGuess {
  let bestToken = "";
  let bestLogit = Number.NEGATIVE_INFINITY;
  for (const [token, logit] of logitsByToken) {
    if (logit > bestLogit) {
      bestLogit = logit;
      bestToken = token;
    }
  }
  if (bestToken === "") throw new Error("pickLanguage needs at least one language token");
  // Subtracting the maximum keeps exp() from overflowing on large logits.
  let sum = 0;
  for (const logit of logitsByToken.values()) sum += Math.exp(logit - bestLogit);
  return { code: bestToken.replace(/^<\|/, "").replace(/\|>$/, ""), probability: 1 / sum };
}

/**
 * Returns the language code when the guess is confident enough; otherwise throws a
 * `TranscriptionError` ("language-uncertain") carrying the guess, so the caller can ask the
 * user in its own terms (the CLI names `--language`).
 */
export function requireConfidentLanguage(guess: LanguageGuess): string {
  if (guess.probability >= MIN_LANGUAGE_PROBABILITY) return guess.code;
  const percent = Math.round(guess.probability * 100);
  throw new TranscriptionError(
    "language-uncertain",
    `Could not tell which language is spoken (best guess "${guess.code}", ${percent}% sure).`,
    guess,
  );
}

const WINDOW_SAMPLES = 320; // 20 ms at 16 kHz
/** Keep a little audio before the first loud window: word onsets are quieter than vowels. */
const MARGIN_SAMPLES = 3200; // 200 ms

/**
 * Index of the first sample of speech, found as the first 20 ms window whose loudness reaches
 * a tenth of the loudest window (with a floor, so pure noise does not count as speech).
 *
 * Why: every pointcast recording starts with silence (the user presses Record, then speaks),
 * and D1 notes that language detection fails on leading silence. Relative to the loudest
 * window rather than a fixed level, so a quiet microphone is handled too.
 */
export function speechStartSample(samples: Float32Array): number {
  const rms: number[] = [];
  for (let start = 0; start + WINDOW_SAMPLES <= samples.length; start += WINDOW_SAMPLES) {
    let energy = 0;
    for (let i = start; i < start + WINDOW_SAMPLES; i++) energy += (samples[i] ?? 0) ** 2;
    rms.push(Math.sqrt(energy / WINDOW_SAMPLES));
  }
  const loudest = Math.max(0, ...rms);
  const threshold = Math.max(0.003, loudest / 10);
  const first = rms.findIndex((value) => value >= threshold);
  if (first < 0) return 0;
  return Math.max(0, first * WINDOW_SAMPLES - MARGIN_SAMPLES);
}
