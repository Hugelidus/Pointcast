import { describe, expect, it } from "vitest";
import { encodeWavPcm16Mono16k, readWavPcm16Mono16k, UnsupportedWavError } from "./wav";

/**
 * Builds a synthetic PCM16 mono WAV buffer from raw int16 samples.
 *
 * @param fmtChunkSize 16 (canonical) or 18 (WAVEFORMATEX with a trailing cbSize=0),
 *   the two shapes real encoders produce — see wav.ts for why the reader must not
 *   assume a fixed 44-byte header.
 */
function buildWav(
  samples: number[],
  opts: { sampleRate?: number; channels?: number; bitsPerSample?: number; audioFormat?: number; fmtChunkSize?: 16 | 18 } = {},
): Uint8Array {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const audioFormat = opts.audioFormat ?? 1;
  const fmtChunkSize = opts.fmtChunkSize ?? 16;

  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const fmtBodySize = fmtChunkSize;
  const totalSize = 4 /* WAVE */ + (8 + fmtBodySize) + (8 + dataSize);

  const buf = new ArrayBuffer(8 + totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let pos = 0;

  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes[pos + i] = s.charCodeAt(i);
    pos += s.length;
  };

  writeAscii("RIFF");
  view.setUint32(pos, totalSize, true);
  pos += 4;
  writeAscii("WAVE");

  writeAscii("fmt ");
  view.setUint32(pos, fmtBodySize, true);
  pos += 4;
  const fmtStart = pos;
  view.setUint16(fmtStart + 0, audioFormat, true);
  view.setUint16(fmtStart + 2, channels, true);
  view.setUint32(fmtStart + 4, sampleRate, true);
  view.setUint32(fmtStart + 8, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(fmtStart + 12, channels * bytesPerSample, true); // block align
  view.setUint16(fmtStart + 14, bitsPerSample, true);
  if (fmtChunkSize === 18) {
    view.setUint16(fmtStart + 16, 0, true); // cbSize
  }
  pos += fmtBodySize;

  writeAscii("data");
  view.setUint32(pos, dataSize, true);
  pos += 4;
  for (const s of samples) {
    if (bytesPerSample === 1) {
      view.setInt8(pos, s);
    } else {
      view.setInt16(pos, s, true);
    }
    pos += bytesPerSample;
  }

  return bytes;
}

describe("readWavPcm16Mono16k", () => {
  it("decodes a canonical 44-byte-header WAV into normalized Float32 samples", () => {
    const wav = buildWav([0, 32767, -32768, -16384], { fmtChunkSize: 16 });
    const samples = readWavPcm16Mono16k(wav);
    expect(samples.length).toBe(4);
    expect(samples[0]).toBeCloseTo(0, 5);
    expect(samples[1]).toBeCloseTo(1, 5);
    expect(samples[2]).toBeCloseTo(-1, 5);
    expect(samples[3]).toBeCloseTo(-0.5, 5);
  });

  it("decodes a WAV with an 18-byte fmt chunk (data shifted past byte 44)", () => {
    const wav = buildWav([100, -100], { fmtChunkSize: 18 });
    const samples = readWavPcm16Mono16k(wav);
    expect(samples.length).toBe(2);
    expect(samples[0]).toBeCloseTo(100 / 32767, 5);
    expect(samples[1]).toBeCloseTo(-100 / 32768, 5);
  });

  it("rejects a non-RIFF file", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => readWavPcm16Mono16k(bytes)).toThrow(UnsupportedWavError);
  });

  it("rejects non-PCM encodings (e.g. IEEE float, format code 3)", () => {
    const wav = buildWav([0, 1], { audioFormat: 3 });
    expect(() => readWavPcm16Mono16k(wav)).toThrow(/PCM/);
  });

  it("rejects unsupported bit depths", () => {
    const wav = buildWav([0, 1], { bitsPerSample: 8 });
    expect(() => readWavPcm16Mono16k(wav)).toThrow(/bit depth/);
  });

  it("rejects non-mono audio", () => {
    const wav = buildWav([0, 1, 2, 3], { channels: 2 });
    expect(() => readWavPcm16Mono16k(wav)).toThrow(/channel/);
  });

  it("rejects sample rates other than 16 kHz", () => {
    const wav = buildWav([0, 1], { sampleRate: 44100 });
    expect(() => readWavPcm16Mono16k(wav)).toThrow(/sample rate/);
  });

  it("rejects a file too small to contain a header", () => {
    expect(() => readWavPcm16Mono16k(new Uint8Array([1, 2, 3]))).toThrow(UnsupportedWavError);
  });
});

describe("encodeWavPcm16Mono16k", () => {
  it("round-trips through readWavPcm16Mono16k within int16 rounding error", () => {
    const original = new Float32Array([0, 1, -1, 0.5, -0.5, 0.25]);
    const wav = encodeWavPcm16Mono16k(original);
    const decoded = readWavPcm16Mono16k(wav);
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i]!, 4);
    }
  });

  it("produces a canonical 44-byte header that readWavPcm16Mono16k accepts", () => {
    const wav = encodeWavPcm16Mono16k(new Float32Array([0, 0, 0]));
    expect(wav.length).toBe(44 + 6);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
  });
});
