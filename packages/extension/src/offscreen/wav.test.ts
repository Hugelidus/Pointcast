import { describe, expect, it } from "vitest";
import { encodeWavPcm16, mixToMono } from "./wav";

describe("mixToMono", () => {
  it("returns an empty signal for no channels and the channel itself for mono", () => {
    expect(mixToMono([])).toHaveLength(0);
    const mono = new Float32Array([0.5, -0.5]);
    expect(mixToMono([mono])).toBe(mono);
  });

  it("averages stereo channels", () => {
    const mixed = mixToMono([new Float32Array([1, 0.5]), new Float32Array([0, -0.5])]);
    expect(Array.from(mixed)).toEqual([0.5, 0]);
  });
});

describe("encodeWavPcm16", () => {
  const wav = encodeWavPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000);
  const view = new DataView(wav);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(wav, offset, length));

  it("writes a 16 kHz mono 16-bit PCM header", () => {
    expect(text(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(12);
    expect(wav.byteLength).toBe(44 + 12);
  });

  it("converts samples to int16 and clamps out-of-range values", () => {
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});
