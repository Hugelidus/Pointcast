import { AUDIO_FILE } from "./session-file";
import { encodeWavPcm16, mixToMono } from "./wav";

/**
 * Converts the MediaRecorder output (WebM/Opus at 48 kHz) into 16 kHz mono samples, the input
 * Whisper needs and the format of audio.wav (D6).
 *
 * An OfflineAudioContext does both jobs: decodeAudioData decodes the compressed stream and
 * resamples it to the context's own sample rate (Chrome uses a high-quality sinc resampler).
 * Unlike a regular AudioContext it never opens an output device, so nothing can be heard.
 */
export async function decodeRecording(recording: Blob): Promise<Float32Array> {
  // An empty blob (stop pressed within the first moments) cannot be decoded; it is a valid,
  // zero-length session rather than an error.
  if (recording.size === 0) return new Float32Array(0);
  const context = new OfflineAudioContext(1, 1, AUDIO_FILE.sampleRate);
  const decoded = await context.decodeAudioData(await recording.arrayBuffer());
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  return mixToMono(channels);
}

export function samplesDurationMs(samples: Float32Array): number {
  return Math.round((samples.length * 1000) / AUDIO_FILE.sampleRate);
}

export function wavBlob(samples: Float32Array): Blob {
  return new Blob([encodeWavPcm16(samples, AUDIO_FILE.sampleRate)], { type: "audio/wav" });
}
