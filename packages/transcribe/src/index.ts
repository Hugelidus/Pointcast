/**
 * @pointcast/transcribe: local Whisper transcription with word timestamps, shared by the CLI
 * (Node) and the extension (a browser worker bundled by WXT). Nothing here imports `node:`
 * modules or touches the DOM; what differs between the two runtimes comes in as
 * `LocalEngineOptions`.
 */
export type {
  TranscribeOptions,
  TranscriptionEngine,
  TranscriptionProgress,
  TranscriptionProgressListener,
} from "./types";
export {
  LocalTranscriptionEngine,
  DEFAULT_MODEL,
  DEFAULT_DTYPE,
  defaultDtype,
  type LocalEngineOptions,
  type WeightsDtype,
} from "./local";
export { TranscriptionError, type TranscriptionErrorCode } from "./errors";
export {
  MIN_LANGUAGE_PROBABILITY,
  pickLanguage,
  requireConfidentLanguage,
  speechStartSample,
  type LanguageGuess,
} from "./language";
export { dropReemittedWords } from "./monotonic";
export { findCut, joinSegments, MIN_SEGMENT_S, MAX_SEGMENT_S } from "./segments";
