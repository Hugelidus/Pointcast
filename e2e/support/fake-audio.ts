import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeWavPcm16 } from "../../packages/extension/src/offscreen/wav";
import { FIXTURE_WAV } from "./paths";

/**
 * File Chrome plays as the fake microphone (--use-file-for-fake-audio-capture, looped).
 * Prefers the spoken fixture; otherwise writes a 440 Hz tone WAV into `tempDir`.
 * The file is only ever read by Chrome's fake capture device, which is never audible.
 */
export function fakeMicrophoneFile(tempDir: string): string {
  if (existsSync(FIXTURE_WAV)) return FIXTURE_WAV;
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  const file = path.join(tempDir, "tone.wav");
  writeFileSync(file, Buffer.from(encodeWavPcm16(samples, sampleRate)));
  return file;
}
