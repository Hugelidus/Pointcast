import { stat } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors";
import { readSessionFile } from "./process/session-file";

export interface AudioTarget {
  audioPath: string;
  wordsPath: string;
}

/**
 * What `pointcast transcribe <target>` reads and writes. The target is either a .wav file, or
 * a session directory: then the audio file is the one session.json names (validated, so a
 * half-written or malformed file gives a clear message and cannot point outside the folder),
 * or "audio.wav" in a bare folder without session.json.
 */
export async function resolveAudioTarget(target: string): Promise<AudioTarget> {
  const targetStat = await stat(target).catch(() => {
    throw new CliError(`No such file or directory: ${target}`);
  });

  if (targetStat.isFile()) {
    if (!target.toLowerCase().endsWith(".wav")) throw new CliError(`Expected a .wav file, got: ${target}`);
    return { audioPath: target, wordsPath: path.join(path.dirname(target), "words.json") };
  }

  const hasSessionFile = await stat(path.join(target, "session.json")).then(
    (found) => found.isFile(),
    () => false,
  );
  let audioFile = "audio.wav";
  if (hasSessionFile) {
    const { audio } = await readSessionFile(target);
    // v2 sessions may be saved without audio (schema.ts); they already carry words.json.
    if (!audio) throw new CliError(`${target} was saved without audio, so there is nothing to transcribe.`);
    audioFile = audio.file;
  }
  return { audioPath: path.join(target, audioFile), wordsPath: path.join(target, "words.json") };
}
