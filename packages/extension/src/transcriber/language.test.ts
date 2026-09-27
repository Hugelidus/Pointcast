import { describe, expect, it, vi } from "vitest";
import type { WordsFile } from "@pointcast/core";
import { TranscriptionError } from "@pointcast/transcribe";
import { transcribeWithFallback, type Transcriber } from "./language";

const samples = new Float32Array(16_000);
const words = (language: string): WordsFile => ({ schemaVersion: 1, engine: "local:test", language, words: [] });
const unsure = new TranscriptionError("language-uncertain", "Could not tell.", { code: "fr", probability: 0.45 });

/** Refuses to guess when no language is given; transcribes in the given one otherwise. */
function engine(): Transcriber & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(async (_samples: Float32Array, { language }: { language?: string }) => {
      if (language === undefined) throw unsure;
      return words(language);
    }),
  };
}

describe("transcribeWithFallback", () => {
  it("uses the language the user chose", async () => {
    expect(await transcribeWithFallback(engine(), samples, "es", "en")).toEqual({ words: words("es") });
  });

  it("falls back to the last session's language when detection is unsure, and says so", async () => {
    const e = engine();
    expect(await transcribeWithFallback(e, samples, undefined, "es")).toEqual({
      words: words("es"),
      fallback: { guess: { code: "fr", probability: 0.45 }, used: "es", reason: "last-used" },
    });
    expect(e.transcribe).toHaveBeenCalledTimes(2);
  });

  it("uses the best guess when there is no last language", async () => {
    expect(await transcribeWithFallback(engine(), samples, undefined, undefined)).toMatchObject({
      words: words("fr"),
      fallback: { used: "fr", reason: "best-guess" },
    });
  });

  it("passes every other error on", async () => {
    const failing: Transcriber = { transcribe: async () => Promise.reject(new Error("offline")) };
    await expect(transcribeWithFallback(failing, samples, undefined, "es")).rejects.toThrow("offline");
  });
});
