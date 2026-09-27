import { SCHEMA_VERSION, type CapturedEvent, type SessionFile } from "@pointcast/core";

/** Format of audio.wav: what Whisper expects, so the CLI never needs ffmpeg (D6). */
export const AUDIO_FILE = { file: "audio.wav", format: "wav", sampleRate: 16000, channels: 1 } as const;
export const SESSION_FILE_NAME = "session.json";
export const WORDS_FILE_NAME = "words.json";
export const MARKDOWN_FILE_NAME = "session.md";
/** Saved instead of audio.wav when the browser cannot decode the recording (see recorder.ts). */
export const RAW_AUDIO_FILE_NAME = "audio.webm";

export interface SessionFileInput {
  /** Folder name, chosen by the service worker (session-id.ts). */
  id: string;
  t0: number;
  /** Taken from the decoded audio, not from wall-clock stop time: the audio is the reference. */
  durationMs: number;
  events: readonly CapturedEvent[];
  extensionVersion: string;
  userAgent: string;
  /** True when audio.wav (or the raw recording, named as audio.wav would be) is saved too. */
  withAudio: boolean;
}

export function buildSessionFile(input: SessionFileInput): SessionFile {
  const started = new Date(input.t0);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    startedAt: started.toISOString(),
    t0: input.t0,
    durationMs: input.durationMs,
    // v2: the audio is described only when it is saved (session-format.md).
    ...(input.withAudio ? { audio: { ...AUDIO_FILE } } : {}),
    recorder: { extensionVersion: input.extensionVersion, userAgent: input.userAgent },
    events: [...input.events],
  };
}
