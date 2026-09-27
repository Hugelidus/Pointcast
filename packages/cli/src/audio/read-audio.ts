import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors";
import { readWavPcm16Mono16k } from "./wav";

/**
 * The extension saves the raw recording under this name when the browser could not convert
 * it to WAV (packages/extension/src/offscreen/recorder.ts); the events are saved anyway.
 */
const RAW_RECORDING = "audio.webm";

/** Reads a 16 kHz mono PCM16 WAV, explaining what to do when it is missing. */
export async function readAudioSamples(audioPath: string): Promise<Float32Array> {
  const bytes = await readFile(audioPath).catch(async () => {
    const raw = path.join(path.dirname(audioPath), RAW_RECORDING);
    const hasRaw = await access(raw).then(
      () => true,
      () => false,
    );
    throw new CliError(
      hasRaw
        ? `${audioPath} is missing, but the raw recording ${raw} is there (the browser could not convert it). ` +
            `Convert it with: ffmpeg -i "${raw}" -ar 16000 -ac 1 "${audioPath}"`
        : `Audio file not found: ${audioPath}`,
    );
  });
  return readWavPcm16Mono16k(bytes);
}
