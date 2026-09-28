import { renderMarkdown, unreliableTimes, type CapturedEvent, type SessionFile, type WordsFile } from "@pointcast/core";
import type { ProcessingOptions, ProcessingResult } from "../messages";
import { explainTranscriptionFailure } from "../processing/failure";
import { languageName } from "../processing/settings";
import type { TranscribeDone } from "../transcriber/protocol";
import { samplesDurationMs, wavBlob } from "./audio";
import type { CodeResolution } from "./dev-server";
import type { LiveTranscription } from "./live-transcription";
import {
  AUDIO_FILE,
  MARKDOWN_FILE_NAME,
  RAW_AUDIO_FILE_NAME,
  SESSION_FILE_NAME,
  WORDS_FILE_NAME,
  buildSessionFile,
} from "./session-file";

/** Everything the recorder hands over when it stops; the rest happens here. */
export interface ProcessingJob {
  /** Transcription already under way since Record; finished or abandoned by the caller. */
  live?: LiveTranscription;
  sessionId: string;
  t0: number;
  events: readonly CapturedEvent[];
  extensionVersion: string;
  userAgent: string;
  audio:
    | { decoded: true; samples: Float32Array }
    /** The browser could not decode the recording: only the raw bytes and the wall-clock length. */
    | { decoded: false; raw: Blob; durationMs: number; error: string };
  /** Found while stopping, e.g. the microphone ended early. */
  warnings: string[];
  options: ProcessingOptions;
}

export interface ProcessorDeps {
  transcribe(samples: Float32Array, options: ProcessingOptions): Promise<TranscribeDone>;
  copy(text: string): Promise<void>;
  /**
   * Resolves the elements' code pointers (dev-server.ts). Runs while Whisper transcribes, so its
   * time budget adds nothing to Stop -> clipboard unless the dev server is slower than Whisper.
   */
  resolveCode?(session: SessionFile): Promise<CodeResolution>;
}

export interface SessionFileBlob {
  fileName: string;
  blob: Blob;
}

/** A ProcessingResult whose files are still Blobs; the caller turns them into blob: URLs. */
export type ProcessedSession = Omit<ProcessingResult, "files"> & { files: SessionFileBlob[] };

/**
 * Stop → Markdown on the clipboard (D1 note 2026-09-27): transcribe, resolve the code pointers
 * (D9 note 2026-09-27, route 3), fuse and render with @pointcast/core, copy, and list the files
 * to save.
 *
 * Nothing the user recorded is lost when a step fails. If transcription fails, session.json is
 * saved with the audio, so `pointcast process` can finish the job. If the audio cannot even be
 * decoded, the events are saved with the raw recording (D6 note 2026-09-26). The audio is also
 * kept when the language had to be guessed, so a wrong guess can be redone without re-recording.
 */
export async function processSession(job: ProcessingJob, deps: ProcessorDeps): Promise<ProcessedSession> {
  const warnings = [...job.warnings];
  const session = (withAudio: boolean, durationMs: number, events: readonly CapturedEvent[] = job.events) =>
    buildSessionFile({
      id: job.sessionId,
      t0: job.t0,
      durationMs,
      events,
      extensionVersion: job.extensionVersion,
      userAgent: job.userAgent,
      withAudio,
    });

  if (!job.audio.decoded) {
    const { raw, durationMs, error } = job.audio;
    return {
      files: [jsonFile(SESSION_FILE_NAME, session(true, durationMs)), { fileName: RAW_AUDIO_FILE_NAME, blob: raw }],
      copied: false,
      audioMs: durationMs,
      error: "The audio could not be converted, so nothing was transcribed. Your events and the raw recording are saved.",
      errorDetail:
        `${error}\nThe raw recording is ${RAW_AUDIO_FILE_NAME} in the session folder: convert it with ` +
        `"ffmpeg -i ${RAW_AUDIO_FILE_NAME} -ar 16000 -ac 1 ${AUDIO_FILE.file}", then run "pointcast process".`,
      ...joinedWarnings(warnings),
    };
  }

  const { samples } = job.audio;
  const audioMs = samplesDurationMs(samples);
  const audioFile = (): SessionFileBlob => ({ fileName: AUDIO_FILE.file, blob: wavBlob(samples) });
  // The events are final at Stop, so the code pointers resolve while the audio is transcribed.
  const resolving = resolveCode(deps, session(false, audioMs));

  let done: Omit<TranscribeDone, "type">;
  try {
    // Nothing to transcribe in an empty recording (Stop pressed right after Record).
    done = samples.length === 0 ? { words: emptyWords(), loadMs: 0, transcribeMs: 0 } : await deps.transcribe(samples, job.options);
  } catch (error) {
    // A known failure (model download, memory, deadline) in words the user can act on; the raw
    // message goes to the popup's Details (processing/failure.ts).
    const { error: message, errorDetail } = explainTranscriptionFailure(rawMessage(error));
    return {
      files: [jsonFile(SESSION_FILE_NAME, session(true, audioMs)), audioFile()],
      copied: false,
      audioMs,
      error: message,
      errorDetail,
      ...joinedWarnings(warnings),
    };
  }

  const { words, fallback } = done;
  if (fallback) {
    const used = languageName(fallback.used);
    const guess = `${languageName(fallback.guess.code)}, ${Math.round(fallback.guess.probability * 100)} % sure`;
    warnings.push(
      fallback.reason === "last-used"
        ? `Not sure which language you spoke (best guess ${guess}), so it was transcribed as ${used}, the language of your last session.`
        : `Not sure which language you spoke; it was transcribed as ${used} (${guess}).`,
      "If that is wrong, pick the language in the popup; the audio was kept for the CLI.",
    );
  }
  const unreliable = unreliableTimes(words);
  if (unreliable) {
    // The spec says so too (core's renderer), but the user should hear it before pasting.
    warnings.push(`The transcript around ${unreliable} looked unreliable and was dropped; say it again if something is missing.`);
  }
  const withAudio = job.options.keepAudio || fallback !== undefined;
  const code = await resolving;
  const sessionFile = session(withAudio, audioMs, code.session.events);
  const markdown = renderMarkdown(sessionFile, words);

  let copied = true;
  try {
    await deps.copy(markdown);
  } catch (error) {
    copied = false;
    warnings.push(`Could not copy to the clipboard (${rawMessage(error)}): use Copy again in the popup.`);
  }

  return {
    // session.md first: "Show in folder" selects the first file.
    files: [
      { fileName: MARKDOWN_FILE_NAME, blob: new Blob([markdown], { type: "text/markdown" }) },
      jsonFile(WORDS_FILE_NAME, words),
      jsonFile(SESSION_FILE_NAME, sessionFile),
      ...(withAudio ? [audioFile()] : []),
    ],
    markdown,
    copied,
    ...(words.language ? { language: words.language } : {}),
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
    ...(code.note ? { code: code.note } : {}),
    audioMs,
    ...(samples.length > 0 ? { timings: { loadMs: done.loadMs, transcribeMs: done.transcribeMs, audioMs: done.audioMs ?? audioMs } } : {}),
  };
}

/** Without a resolver, or if it fails, the session stays as captured: the spec is never worse for it. */
async function resolveCode(deps: ProcessorDeps, session: SessionFile): Promise<CodeResolution> {
  if (!deps.resolveCode) return { session };
  try {
    return await deps.resolveCode(session);
  } catch {
    return { session };
  }
}

function jsonFile(fileName: string, value: SessionFile | WordsFile): SessionFileBlob {
  return { fileName, blob: new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }) };
}

/** words.json of a recording with no audio: valid, and says why it is empty. */
function emptyWords(): WordsFile {
  return { schemaVersion: 1, engine: "none (empty recording)", words: [] };
}

/**
 * What was found while stopping (e.g. the microphone ended early) stays a warning next to the
 * error, rather than being appended to it: the error line is the one thing to act on.
 */
function joinedWarnings(warnings: string[]): { warning?: string } {
  return warnings.length > 0 ? { warning: warnings.join(" ") } : {};
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
