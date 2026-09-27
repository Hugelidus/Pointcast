import type { WordsFile } from "@pointcast/core";
import type { TranscriptionError } from "@pointcast/transcribe";
import type { LanguageFallback } from "./protocol";

/** The part of LocalTranscriptionEngine this needs, so tests can pass a stand-in. */
export interface Transcriber {
  transcribe(samples: Float32Array, opts: { language?: string }): Promise<WordsFile>;
}

/**
 * Transcribes in the user's language, or detects it. When detection is unsure, the engine
 * refuses to guess (D1): the extension then uses the previous session's language, which is
 * usually right for the same person, or the best guess when there is none, and says which.
 * Either way the session is transcribed: the popup and the notification tell the user to pick
 * the language if it was wrong, and the audio is kept so the CLI can redo it (session-processor.ts).
 */
export async function transcribeWithFallback(
  engine: Transcriber,
  samples: Float32Array,
  language: string | undefined,
  fallbackLanguage: string | undefined,
): Promise<{ words: WordsFile; fallback?: LanguageFallback }> {
  try {
    return { words: await engine.transcribe(samples, { language }) };
  } catch (error) {
    const guess = uncertainGuess(error);
    if (language !== undefined || !guess) throw error;
    const used = fallbackLanguage ?? guess.code;
    const fallback: LanguageFallback = { guess, used, reason: fallbackLanguage ? "last-used" : "best-guess" };
    return { words: await engine.transcribe(samples, { language: used }), fallback };
  }
}

/** The guess of a "language-uncertain" refusal. Checked by `code`, which survives bundling twice. */
function uncertainGuess(error: unknown): TranscriptionError["guess"] {
  const refusal = error as Partial<TranscriptionError> | null;
  return refusal?.code === "language-uncertain" ? refusal.guess : undefined;
}
