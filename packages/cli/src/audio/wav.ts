/**
 * Reads a PCM16 WAV file into a mono Float32Array at 16 kHz, the exact format the
 * extension exports (docs/session-format.md) and the format every transcription
 * engine in packages/cli/src/transcribe expects.
 *
 * We do not resample or downmix: pointcast controls both ends of this file (the
 * extension always records 16 kHz mono PCM16), so any other format is either a
 * corrupted recording or a fixture built wrong — surfacing that early with a clear
 * error is more useful than silently "fixing" it with a lossy conversion.
 */

/** Thrown for any WAV file this reader will not attempt to decode. Message is meant to reach a user's terminal as-is. */
export class UnsupportedWavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedWavError";
  }
}

interface WavFormat {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

const RIFF_FORMAT_PCM = 1;
/** WAVE_FORMAT_EXTENSIBLE: the real format lives in the sub-format GUID, which we do not parse. */
const RIFF_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Walks RIFF chunks looking for "fmt " and "data". We cannot assume the canonical
 * 44-byte header: PowerShell's SpeechAudioFormatInfo (used to synthesize our own test
 * fixtures) writes an 18-byte fmt chunk (with a trailing cbSize field), which shifts
 * "data" to byte 46 — a fixed-offset reader silently reads garbage bytes as audio.
 */
function findChunks(view: DataView, buffer: Uint8Array): { fmt: number; data: number; dataSize: number } {
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  let pos = 12; // after "RIFF" size "WAVE"
  while (pos + 8 <= buffer.length) {
    const id = readAscii(buffer, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const bodyStart = pos + 8;
    if (id === "fmt ") {
      fmtOffset = bodyStart;
    } else if (id === "data") {
      dataOffset = bodyStart;
      dataSize = size;
    }
    // Chunks are word-aligned: a chunk with an odd size has one padding byte after it.
    pos = bodyStart + size + (size % 2);
  }

  if (fmtOffset === -1) {
    throw new UnsupportedWavError("WAV file has no 'fmt ' chunk.");
  }
  if (dataOffset === -1) {
    throw new UnsupportedWavError("WAV file has no 'data' chunk.");
  }
  return { fmt: fmtOffset, data: dataOffset, dataSize };
}

function readAscii(buffer: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(buffer[offset + i] ?? 0);
  }
  return s;
}

function readFormat(view: DataView, fmtOffset: number): WavFormat {
  return {
    audioFormat: view.getUint16(fmtOffset + 0, true),
    channels: view.getUint16(fmtOffset + 2, true),
    sampleRate: view.getUint32(fmtOffset + 4, true),
    bitsPerSample: view.getUint16(fmtOffset + 14, true),
  };
}

/**
 * Parses a WAV file and returns its audio as mono Float32Array samples in [-1, 1], at 16 kHz.
 *
 * @throws {UnsupportedWavError} if the file is not RIFF/WAVE, not PCM16, not mono, or not 16 kHz.
 */
export function readWavPcm16Mono16k(bytes: ArrayBuffer | Uint8Array): Float32Array {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buffer.length < 12) {
    throw new UnsupportedWavError("File is too small to be a WAV file.");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const riff = readAscii(buffer, 0, 4);
  const wave = readAscii(buffer, 8, 4);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new UnsupportedWavError(`Not a RIFF/WAVE file (got "${riff}"/"${wave}").`);
  }

  const { fmt: fmtOffset, data: dataOffset, dataSize } = findChunks(view, buffer);
  const format = readFormat(view, fmtOffset);

  if (format.audioFormat !== RIFF_FORMAT_PCM) {
    const name = format.audioFormat === RIFF_FORMAT_EXTENSIBLE ? "WAVE_FORMAT_EXTENSIBLE" : `code ${format.audioFormat}`;
    throw new UnsupportedWavError(
      `Unsupported WAV encoding (${name}): only uncompressed PCM is supported. Re-export as 16 kHz mono 16-bit PCM.`,
    );
  }
  if (format.bitsPerSample !== 16) {
    throw new UnsupportedWavError(
      `Unsupported bit depth (${format.bitsPerSample}-bit): only 16-bit PCM is supported.`,
    );
  }
  if (format.channels !== 1) {
    throw new UnsupportedWavError(
      `Unsupported channel count (${format.channels}): only mono WAV is supported. Downmix before transcribing.`,
    );
  }
  if (format.sampleRate !== 16000) {
    throw new UnsupportedWavError(
      `Unsupported sample rate (${format.sampleRate} Hz): only 16 kHz is supported.`,
    );
  }

  // Clamp to the bytes actually present: a fixture or a truncated recording may report
  // a data chunk size larger than what follows in the file.
  const available = buffer.length - dataOffset;
  const usableBytes = Math.min(dataSize, available) & ~1; // whole 16-bit samples only
  const sampleCount = usableBytes / 2;

  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(dataOffset + i * 2, true);
    // int16 ranges over [-32768, 32767] (asymmetric). Dividing by 32768 on the negative
    // side and 32767 on the positive side maps both ends to exactly [-1, 1] instead of
    // leaving +32767 short at ~0.99997 (transformers.js's own decoders do the same).
    samples[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
  }
  return samples;
}

/**
 * Encodes mono Float32Array samples (expected range [-1, 1], as produced by
 * readWavPcm16Mono16k) back into a canonical 44-byte-header PCM16 16 kHz mono WAV file.
 *
 * Needed because packages/cli/src/transcribe engines operate on decoded samples, not
 * file paths — the OpenAI-compatible engine still has to upload an actual audio file
 * (its API takes multipart file data, not raw floats), so it re-encodes here instead of
 * keeping the original WAV bytes around at every call site.
 */
export function encodeWavPcm16Mono16k(samples: Float32Array): Uint8Array {
  const sampleRate = 16000;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // canonical fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(44 + i * 2, Math.round(int16), true);
  }

  return bytes;
}
