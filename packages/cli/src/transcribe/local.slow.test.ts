import { readFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeWord } from "@pointcast/core";
import { readWavPcm16Mono16k } from "../audio/wav";
import { LocalTranscriptionEngine, type TranscriptionProgress } from "@pointcast/transcribe";

/**
 * The default local engine (packages/transcribe, as the CLI configures it) on a 2.5-minute
 * Spanish narration (dev/fixtures/audio/es-2min.wav, overlapping 30 s chunks of its speech). Real model, so
 * guarded like run.slow.test.ts. Run with:
 *   POINTCAST_SLOW=1 pnpm vitest run packages/cli/src/transcribe/local.slow.test.ts
 */
const AUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dev/fixtures/audio/es-2min.wav");

/** Plan step 3: "a 2-minute Spanish recording … in under 60 s on a laptop CPU". */
const TIME_BUDGET_S = 60;

describe.skipIf(process.env.POINTCAST_SLOW !== "1")("LocalTranscriptionEngine on long audio", () => {
  beforeAll(() => {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  });

  it("returns time-ordered words without repeating chunk overlaps, within the plan's time budget", { timeout: 300_000 }, async () => {
    const samples = readWavPcm16Mono16k(readFileSync(AUDIO));
    const progress: TranscriptionProgress[] = [];
    const engine = new LocalTranscriptionEngine({ threads: 4, onProgress: (p) => progress.push(p) });

    const started = performance.now();
    const { words, language } = await engine.transcribe(samples, { language: "es" });
    const seconds = (performance.now() - started) / 1000;
    console.log(`es-2min (${(samples.length / 16000).toFixed(0)} s of audio): ${words.length} words in ${seconds.toFixed(1)} s`);

    expect(language).toBe("es");
    expect(words.length).toBeGreaterThan(250); // 290 words were spoken

    // Time never goes backwards (before the fix, word 97 started 3.7 s before word 96).
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);

    // No span is emitted twice: the narration never repeats 6 words in a row.
    const text = words.map((word) => normalizeWord(word.text));
    const seen = new Set<string>();
    for (let i = 0; i + 6 <= text.length; i++) {
      const window = text.slice(i, i + 6).join(" ");
      expect(seen.has(window), `repeated: "${window}"`).toBe(false);
      seen.add(window);
    }

    // The progress a UI would show: model load, then every chunk, then the result.
    const stages = progress.map((p) => p.stage);
    expect(stages[0]).toBe("loading-model");
    expect(stages.indexOf("model-ready")).toBeGreaterThan(0);
    const chunks = progress.flatMap((p) => (p.stage === "transcribing" ? [`${p.chunksDone}/${p.chunksTotal}`] : []));
    // Only the speech is transcribed (the VAD cuts silences of 2 s or more), so the 152 s make
    // fewer than the 8 chunks the whole recording would.
    const total = chunks.length - 1;
    expect(total).toBeGreaterThanOrEqual(4);
    expect(chunks).toEqual(Array.from({ length: total + 1 }, (_, done) => `${done}/${total}`));
    expect(progress.at(-1)).toEqual({ stage: "done", language: "es", words: words.length });

    // Includes loading the model from the local cache: what a user waits for.
    expect(seconds).toBeLessThan(TIME_BUDGET_S);
  });
});
