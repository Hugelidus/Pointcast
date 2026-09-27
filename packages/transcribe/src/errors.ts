import type { LanguageGuess } from "./language";

/**
 * Why a transcription was refused (rather than failing unexpectedly):
 * - `language-uncertain`: no language was given and detection was not sure enough (`guess` says
 *   what it thought). Transcribing anyway would produce fluent nonsense (D1 note, 2026-09-26).
 * - `language-detection-unsupported`: no language was given and the model has no language tokens
 *   to detect one with (an English-only model, for instance).
 *
 * In both cases the fix is the same: ask the user for the language and call again with it.
 */
export type TranscriptionErrorCode = "language-uncertain" | "language-detection-unsupported";

/**
 * An error the user can act on. `message` says what went wrong in plain words but not what to
 * do: that depends on the interface (a `--language` flag in the CLI, a language picker in the
 * extension), so each caller adds its own instruction.
 *
 * `code` survives where the class does not: an error posted from a worker arrives as a plain
 * object, so post `{ code, message, guess }` rather than relying on `instanceof`.
 */
export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  /** Set for `language-uncertain`. */
  readonly guess?: LanguageGuess;

  constructor(code: TranscriptionErrorCode, message: string, guess?: LanguageGuess) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    if (guess !== undefined) this.guess = guess;
  }
}
