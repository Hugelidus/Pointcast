import { readFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeWord } from "@pointcast/core";
import { LocalTranscriptionEngine } from "@pointcast/transcribe";
import { readWavPcm16Mono16k } from "../audio/wav";

/**
 * Silence and room noise with the real models (D1 note 2026-09-28). Before the VAD, 15 s of room
 * noise at -49 dBFS came out as "¡Adiós!", and 20 s as "¡Adiós!" timed 16.34-29.98 s. Guarded
 * like local.slow.test.ts:
 *   POINTCAST_SLOW=1 pnpm vitest run packages/cli/src/transcribe/silence.slow.test.ts
 */
const ES_SHORT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dev/fixtures/audio/es-short.wav");
const RATE = 16000;

/** Room noise: pink-ish noise with a faint mains hum, at `dbfs` RMS. Seeded, so runs repeat. */
function roomNoise(seconds: number, dbfs: number, seed: number): Float32Array {
  let state = seed >>> 0;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const out = new Float32Array(Math.round(seconds * RATE));
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = random();
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[i] = b0 + b1 + b2 + white * 0.1848 + 0.3 * Math.sin((2 * Math.PI * 50 * i) / RATE);
  }
  let energy = 0;
  for (const value of out) energy += value * value;
  const gain = 10 ** (dbfs / 20) / Math.sqrt(energy / out.length);
  return out.map((value) => value * gain);
}

describe.skipIf(process.env.POINTCAST_SLOW !== "1")("LocalTranscriptionEngine on silence", () => {
  const engine = new LocalTranscriptionEngine({ threads: 4 });

  beforeAll(async () => {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
    await engine.preload();
  }, 300_000);

  it("hears nothing in room noise, in any language, even when asked to detect it", { timeout: 120_000 }, async () => {
    for (const [seconds, dbfs, language] of [[15, -49, "es"], [20, -49, "es"], [30, -40, "en"], [15, -49, undefined]] as const) {
      const words = await engine.transcribe(roomNoise(seconds, dbfs, seconds), language ? { language } : {});
      expect(words.words, `${seconds} s at ${dbfs} dBFS`).toEqual([]);
      expect(words.unreliable).toBeUndefined();
    }
  });

  it("transcribes speech on both sides of a long silence, and invents nothing in it", { timeout: 120_000 }, async () => {
    const phrase = readWavPcm16Mono16k(readFileSync(ES_SHORT));
    const gap = 12 * RATE;
    const samples = new Float32Array(phrase.length * 2 + gap);
    samples.set(phrase, 0);
    samples.set(phrase, phrase.length + gap);
    const noise = roomNoise(samples.length / RATE, -49, 9);
    for (let i = 0; i < samples.length; i++) samples[i]! += noise[i]!;

    const { words } = await engine.transcribe(samples, { language: "es" });
    const secondStart = ((phrase.length + gap) * 1000) / RATE;
    const first = words.filter((word) => word.start < secondStart);
    const second = words.filter((word) => word.start >= secondStart);
    // Each copy of "Esto me gustaría que estuviera filtrado por cantidad, y además esto que
    // exporte solo lo filtrado." comes out (as Whisper hears it), starting with "Esto".
    for (const part of [first, second]) {
      expect(part.length).toBeGreaterThanOrEqual(14);
      expect(normalizeWord(part[0]!.text)).toBe("esto");
      expect(normalizeWord(part.at(-1)!.text)).toBe("filtrado");
    }
    // Nothing in the silence (the phrase's speech ends about 10.5 s into each copy), and nothing
    // past the end.
    const silenceStart = (phrase.length * 1000) / RATE - 500;
    expect(words.filter((word) => word.start > silenceStart && word.start < secondStart)).toEqual([]);
    expect(words.every((word) => word.end <= (samples.length * 1000) / RATE)).toBe(true);
  });
});
