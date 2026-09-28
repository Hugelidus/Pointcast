/** Reads the header and PCM16 samples of a canonical 44-byte-header WAV (what the extension writes). */
export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  sampleCount: number;
  durationMs: number;
  /** Root mean square of the samples in [0, 1]; ~0 means silence. */
  rms: number;
}

export function readWav(bytes: Buffer): WavInfo {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  if (bytes.toString("ascii", 36, 40) !== "data") throw new Error("Expected the data chunk at byte 36");
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitsPerSample = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  const sampleCount = dataBytes / (channels * (bitsPerSample / 8));

  let sumSquares = 0;
  for (let offset = 44; offset + 1 < 44 + dataBytes; offset += 2) {
    const value = bytes.readInt16LE(offset) / 32768;
    sumSquares += value * value;
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    sampleCount,
    durationMs: (sampleCount * 1000) / sampleRate,
    rms: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0,
  };
}

/**
 * PCM16 mono samples of any RIFF/WAVE file, walking the chunks instead of assuming the 44-byte
 * header: the SAPI-generated fixtures carry an 18-byte fmt chunk, which moves "data" to byte 46.
 */
export function readMonoSamples(bytes: Buffer): { sampleRate: number; samples: Float32Array } {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  let sampleRate = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (bytes.readUInt16LE(body + 2) !== 1 || bytes.readUInt16LE(body + 14) !== 16) {
        throw new Error("Expected mono 16-bit PCM");
      }
      sampleRate = bytes.readUInt32LE(body + 4);
    } else if (id === "data") {
      const samples = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(body + 2 * i) / 32768;
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  throw new Error("No data chunk");
}
