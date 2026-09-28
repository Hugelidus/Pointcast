import { describe, expect, it } from "vitest";
import type { Word } from "@pointcast/core";
import { sanitizeWords } from "./sanitize";

/** Words spaced `step` ms apart, each lasting `length` ms, from `from` ms. */
function words(text: string, from = 0, step = 300, length = 250): Word[] {
  return text.split(" ").map((t, i) => ({ text: ` ${t}`, start: from + i * step, end: from + i * step + length }));
}

const texts = (list: readonly Word[]) => list.map((w) => w.text.trim()).join(" ");

describe("sanitizeWords", () => {
  it("leaves a normal transcript alone", () => {
    const input = words("Esto me gustaría que estuviera filtrado por cantidad, y además esto que exporte solo lo filtrado.");
    expect(sanitizeWords(input, { durationMs: 12_000, speech: [{ start: 0, end: 12_000 }] })).toEqual({ words: input, unreliable: [] });
  });

  it("collapses a looped transcript, as a user got it: 'de la' ×430 in 19.2 s, times up to 29.8 s, a last word ending at 0", () => {
    // The shape of that words.json: real speech, then the loop with times squeezed together,
    // past the end of the audio, and a final word whose end is 0.
    const speech = words("Quiero que la tabla", 500);
    const loop: Word[] = [];
    for (let i = 0; i < 430; i++) {
      const at = 2_000 + i * 65;
      loop.push({ text: " de", start: at, end: at + 30 }, { text: " la", start: at + 30, end: at + 65 });
    }
    const last = { text: " la", start: 29_800, end: 0 };
    const result = sanitizeWords([...speech, ...loop, last], { durationMs: 19_200 });

    expect(texts(result.words)).toBe("Quiero que la tabla de la");
    expect(result.unreliable).toHaveLength(1);
    expect(result.unreliable[0]!.start).toBe(2_000);
    expect(result.unreliable[0]!.end).toBeLessThanOrEqual(19_200);
  });

  it("keeps one copy of a sentence repeated over silence, and reports it", () => {
    // "Por favor, vengan a la vida." ×9 over 15 s of silence (a user's report).
    const input = Array.from({ length: 9 }, (_, i) => words("Por favor, vengan a la vida.", i * 1_600, 250, 200)).flat();
    const result = sanitizeWords(input, { durationMs: 15_000 });
    expect(texts(result.words)).toBe("Por favor, vengan a la vida.");
    expect(result.unreliable).toEqual([{ start: 0, end: 8 * 1_600 + 5 * 250 + 200 }]);
  });

  it("collapses 'no, no, no' without a warning: people say that", () => {
    const result = sanitizeWords(words("no, no, no. Así no."), { durationMs: 5_000 });
    expect(texts(result.words)).toBe("no, Así no.");
    expect(result.unreliable).toEqual([]);
  });

  it("does not touch a phrase said twice", () => {
    const input = words("esto aquí y esto aquí");
    expect(sanitizeWords(input, { durationMs: 5_000 }).words).toEqual(input);
  });

  it("drops words outside the audio, and words that end before they start", () => {
    // "¡Adiós!" at 16.34-29.98 s in a 20 s file.
    const input: Word[] = [
      { text: " hola", start: 1_000, end: 1_300 },
      { text: " ¡Adiós!", start: 16_340, end: 29_980 },
      { text: " mal", start: 2_000, end: 1_000 },
      { text: " antes", start: -40, end: 100 },
    ];
    const result = sanitizeWords(input, { durationMs: 20_000 });
    expect(texts(result.words)).toBe("hola");
  });

  it("keeps a last word ending one timestamp step after the audio", () => {
    const input: Word[] = [{ text: " fin.", start: 9_700, end: 10_020 }];
    expect(sanitizeWords(input, { durationMs: 10_000 }).words).toEqual(input);
  });

  it("drops runs of three or more zero-length words, keeps one or two", () => {
    const zero = (text: string, at: number): Word => ({ text: ` ${text}`, start: at, end: at });
    const input: Word[] = [
      { text: " Thank", start: 1_000, end: 1_000 },
      { text: " you.", start: 1_000, end: 1_200 },
      zero("uno", 3_000),
      zero("dos", 3_000),
      zero("tres", 3_020),
      { text: " sigue", start: 3_100, end: 3_400 },
    ];
    const result = sanitizeWords(input, { durationMs: 5_000 });
    expect(texts(result.words)).toBe("Thank you. sigue");
    expect(result.unreliable).toEqual([{ start: 3_000, end: 3_020 }]);
  });

  describe("known silence hallucinations", () => {
    const speech = [{ start: 0, end: 4_000 }];

    it("are dropped where the VAD heard no speech, without a warning", () => {
      const input = [...words("filtra por cantidad"), ...words("Gracias.", 12_000), ...words("Thank you.", 16_000)];
      const result = sanitizeWords(input, { durationMs: 20_000, speech });
      expect(texts(result.words)).toBe("filtra por cantidad");
      expect(result.unreliable).toEqual([]);
    });

    it("are kept when someone said them", () => {
      const input = words("vale, gracias");
      expect(sanitizeWords(input, { durationMs: 5_000, speech }).words).toEqual(input);
    });

    it("are kept when Whisper timed a real one late, just after the speech", () => {
      // es-2min ends with "Gracias." said at 150.85 s, timed 151.19-151.79 s; the VAD's speech ends first.
      const input: Word[] = [{ text: " Gracias.", start: 151_190, end: 151_790 }];
      expect(sanitizeWords(input, { durationMs: 152_195, speech: [{ start: 150_800, end: 151_400 }] }).words).toEqual(input);
    });

    it("are kept when there was no VAD to tell", () => {
      const input = words("Gracias.", 12_000);
      expect(sanitizeWords(input, { durationMs: 20_000 }).words).toEqual(input);
    });
  });

  it("reports nearby unreliable stretches as one", () => {
    const loopAt = (from: number) => Array.from({ length: 4 }, (_, i) => words("otra vez", from + i * 500, 200, 150)).flat();
    // The first loop ends at 1.85 s, the second starts at 2.5 s.
    const result = sanitizeWords([...loopAt(0), ...words("bien", 2_000), ...loopAt(2_500)], { durationMs: 10_000 });
    expect(texts(result.words)).toBe("otra vez bien otra vez");
    expect(result.unreliable).toEqual([{ start: 0, end: 2_500 + 3 * 500 + 200 + 150 }]);
  });
});
