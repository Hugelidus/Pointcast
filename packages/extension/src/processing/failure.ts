import type { ProcessingResult } from "../messages";
import type { RecorderState } from "../recorder-state";

/**
 * Failures in words a user can act on. A library error ("Could not locate file:
 * "https://…/config.json"") says what broke inside, not what to do; the popup, the pill and the
 * notification show the clear sentence, and the popup keeps the raw text folded under "Details"
 * for a bug report.
 */

/** What failed; declared with RecorderState, re-exported for the writers of `errorKind`. */
export type { ErrorKind } from "../recorder-state";

/** The popup's "Details" for the current error, if there is one. */
export function errorDetailOf(state: RecorderState | ProcessingResult): string | undefined {
  return state.error ? state.errorDetail : undefined;
}

export type TranscriptionFailureKind = "model-download" | "memory" | "timeout" | "other";

/** Said after every transcription failure: nothing the user recorded was lost. */
export const SAVED_NOTE = "Your events and audio are saved.";

/**
 * transformers.js and fetch messages for a model file that could not be downloaded: a missing
 * file or a failed request ("Could not locate file", "Error (503) occurred while trying to load
 * file", "Failed to fetch", "NetworkError…").
 */
const DOWNLOAD =
  /could not locate file|while trying to load file|unauthorized access to file|unable to get model file|failed to fetch|fetch failed|networkerror|network error|load failed|err_internet_disconnected|err_network_changed|err_name_not_resolved/i;

/** ONNX Runtime and V8 messages when the WASM heap cannot grow (whisper-base needs about 1 GB). */
const MEMORY =
  /out of memory|\boom\b|bad_alloc|allocation failed|could not allocate|cannot allocate|failed to allocate|memory access out of bounds|wasm memory/i;

/** client.ts beforeDeadline's message. */
const TIMEOUT = /took too long/i;

export function transcriptionFailureKind(raw: string): TranscriptionFailureKind {
  if (TIMEOUT.test(raw)) return "timeout";
  if (MEMORY.test(raw)) return "memory";
  if (DOWNLOAD.test(raw)) return "model-download";
  return "other";
}

/** The first sentence of each is complete on its own: the notification shows only that one. */
const SENTENCE: Record<TranscriptionFailureKind, string> = {
  "model-download": "Could not download the speech model: check your internet connection, then record again.",
  memory: "Not enough memory to transcribe: close some tabs or apps, then record again.",
  timeout: "Transcription took too long and was stopped: try a shorter recording.",
  other: "Could not transcribe the recording: record again, and if it keeps failing, see Details in the Pointcast popup.",
};

export interface ExplainedFailure {
  kind: TranscriptionFailureKind;
  /** For the popup: what happened and what to do, then that nothing was lost. */
  error: string;
  /** The raw message, and how the saved session can still be transcribed. */
  errorDetail: string;
}

/** A transcription error (worker, deadline, library) in words a user can act on. */
export function explainTranscriptionFailure(raw: string): ExplainedFailure {
  const kind = transcriptionFailureKind(raw);
  return {
    kind,
    error: `${SENTENCE[kind]} ${SAVED_NOTE}`,
    errorDetail: `${raw.trim()}\nThe session folder keeps the events and the audio: "pointcast process" can transcribe it later.`,
  };
}

/**
 * Errors can be long, and the pill and the notification have room for one sentence. A sentence
 * ends at ".", "!" or "?" followed by a space or the end; the colons above keep "what to do" in it.
 */
export function firstSentence(text: string, maxLength = 100): string {
  const end = text.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? text.slice(0, end + 1) : text;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1)}…` : sentence;
}
