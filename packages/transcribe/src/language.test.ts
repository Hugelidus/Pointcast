import { describe, expect, it } from "vitest";
import { TranscriptionError } from "./errors";
import { MIN_LANGUAGE_PROBABILITY, pickLanguage, requireConfidentLanguage, speechStartSample } from "./language";

describe("pickLanguage", () => {
  it("returns the top language token as a code, with its softmax probability", () => {
    // Real logits from Xenova/whisper-base on fixtures/audio/es-short.wav.
    const guess = pickLanguage(new Map([["<|es|>", 23.56], ["<|gl|>", 15.96], ["<|eu|>", 15.17]]));
    expect(guess.code).toBe("es");
    expect(guess.probability).toBeGreaterThan(0.99);
  });

  it("reports low confidence when two languages are close", () => {
    // Real logits on fixtures/audio/en-short.wav (a synthetic voice): an ambiguous case.
    const guess = pickLanguage(new Map([["<|la|>", 14.12], ["<|ar|>", 13.36], ["<|eu|>", 13.12]]));
    expect(guess.code).toBe("la");
    expect(guess.probability).toBeLessThan(MIN_LANGUAGE_PROBABILITY);
  });

  it("does not overflow on large logits", () => {
    expect(pickLanguage(new Map([["<|en|>", 1000], ["<|es|>", 0]])).probability).toBe(1);
  });
});

describe("requireConfidentLanguage", () => {
  it("returns the code when the model is sure enough", () => {
    expect(requireConfidentLanguage({ code: "es", probability: 0.95 })).toBe("es");
  });

  it("refuses to guess: throws a language-uncertain error that carries the guess", () => {
    const guess = { code: "la", probability: 0.52 };
    let thrown: unknown;
    try {
      requireConfidentLanguage(guess);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TranscriptionError);
    expect(thrown).toMatchObject({ code: "language-uncertain", guess });
    // Says what went wrong, not which flag to use: the CLI and the extension ask differently.
    expect((thrown as Error).message).toBe('Could not tell which language is spoken (best guess "la", 52% sure).');
  });
});

describe("speechStartSample", () => {
  const silenceThenTone = (silentSamples: number, amplitude: number): Float32Array => {
    const samples = new Float32Array(silentSamples + 16000);
    for (let i = silentSamples; i < samples.length; i++) samples[i] = amplitude * Math.sin(i / 5);
    return samples;
  };

  it("finds speech after leading silence, keeping a 200 ms margin", () => {
    expect(speechStartSample(silenceThenTone(32000, 0.3))).toBe(32000 - 3200);
  });

  it("works for a quiet microphone (relative threshold)", () => {
    expect(speechStartSample(silenceThenTone(16000, 0.02))).toBe(16000 - 3200);
  });

  it("returns 0 for all-silent audio or audio that starts loud", () => {
    expect(speechStartSample(new Float32Array(16000))).toBe(0);
    expect(speechStartSample(silenceThenTone(0, 0.3))).toBe(0);
  });
});
