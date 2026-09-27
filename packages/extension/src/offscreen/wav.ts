/**
 * Minimal WAV writer: 16-bit PCM, the only format the CLI's Whisper pipeline needs (D6).
 * Writing it by hand is ~30 lines and avoids a dependency for a fixed, well-known header.
 */

/** Averages channels into one; Whisper is mono and a microphone rarely has real stereo. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const [first, ...rest] = channels;
  if (!first) return new Float32Array(0);
  if (rest.length === 0) return first;
  const mono = new Float32Array(first.length);
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}

const HEADER_BYTES = 44;

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * bytes per sample
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp first: resampling can overshoot [-1, 1] slightly, and an unclamped value
    // would wrap around to the opposite sign and click.
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    // Asymmetric scale because int16 spans -32768..32767.
    view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
