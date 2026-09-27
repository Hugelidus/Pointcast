import { readFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeWord, type Word } from "@pointcast/core";
import { findCut, joinSegments, LocalTranscriptionEngine } from "@pointcast/transcribe";
import { readWavPcm16Mono16k } from "../audio/wav";

/**
 * Live transcription (the extension; D1 note 2026-09-27, live transcription) cuts the
 * recording in pauses and transcribes each piece on its own. This checks, with the real model on es-2min, that the cuts
 * neither drop nor repeat words: the words spoken right before and after every cut come out, no
 * span appears twice, and the transcript is as accurate as transcribing the whole file at once.
 * Real model, so guarded like local.slow.test.ts. Run with:
 *   POINTCAST_SLOW=1 pnpm vitest run packages/cli/src/transcribe/segments.slow.test.ts
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/audio");
const RATE = 16000;
/** The extension checks the growing recording every 2 s (offscreen/live-transcription.ts). */
const POLL_S = 2;

describe.skipIf(process.env.POINTCAST_SLOW !== "1")("transcribing in pieces cut at pauses", () => {
  beforeAll(() => {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  });

  it("loses and repeats no word at the cuts, and is as accurate as one pass", { timeout: 300_000 }, async () => {
    const samples = readWavPcm16Mono16k(readFileSync(resolve(FIXTURES, "es-2min.wav")));
    const truth = (JSON.parse(readFileSync(resolve(FIXTURES, "es-2min.words.json"), "utf8")) as {
      words: { text: string; startMs: number }[];
    }).words;
    const engine = new LocalTranscriptionEngine({ threads: 4 });

    // Replay the recording as the extension sees it: a longer prefix every POLL_S seconds.
    const cuts = [0];
    for (let recorded = POLL_S * RATE; recorded < samples.length; recorded += POLL_S * RATE) {
      const cut = findCut(samples.subarray(0, recorded), cuts.at(-1)!);
      if (cut !== undefined) cuts.push(cut);
    }
    const pieces = [];
    for (const [i, start] of cuts.entries()) {
      const piece = samples.subarray(start, cuts[i + 1] ?? samples.length);
      pieces.push({ startSample: start, words: (await engine.transcribe(piece, { language: "es" })).words });
    }
    const live = joinSegments(pieces);
    const whole = (await engine.transcribe(samples, { language: "es" })).words;

    const lengths = cuts.map((start, i) => ((cuts[i + 1] ?? samples.length) - start) / RATE);
    const liveMatch = align(live, truth);
    const wholeMatch = align(whole, truth);
    console.log(
      `es-2min in ${cuts.length} pieces of ${lengths.map((s) => s.toFixed(1)).join(", ")} s: ` +
        `${liveMatch.size}/${truth.length} words right (one pass: ${wholeMatch.size})`,
    );

    expect(lengths.slice(0, -1).every((s) => s >= 15 && s <= 30)).toBe(true);
    // As accurate as one pass, give or take Whisper's own variance: with less context around it,
    // a word here and there comes out differently ("no traerse" / "notrarse"), in the middle of a
    // piece, not at its edges. Measured on 2026-09-27: 266 vs 269 of 290 words.
    expect(liveMatch.size).toBeGreaterThanOrEqual(wholeMatch.size - Math.ceil(0.02 * truth.length));
    // Around every cut, the last word said before it and the first after it come out whenever
    // one pass gets them right (some words, like "exportar", Whisper mishears either way).
    for (const cut of cuts.slice(1)) {
      const after = truth.findIndex((w) => w.startMs >= (cut * 1000) / RATE);
      for (const k of [after - 1, after]) {
        if (wholeMatch.has(k)) expect(liveMatch.has(k), `"${truth[k]!.text}" next to the cut at ${cut / RATE} s`).toBe(true);
      }
    }
    // Nothing repeated, and time moves forward.
    const text = live.map((w) => normalizeWord(w.text));
    const seen = new Set<string>();
    for (let i = 0; i + 6 <= text.length; i++) {
      const window = text.slice(i, i + 6).join(" ");
      expect(seen.has(window), `repeated: "${window}"`).toBe(false);
      seen.add(window);
    }
    for (let i = 1; i < live.length; i++) expect(live[i]!.start).toBeGreaterThanOrEqual(live[i - 1]!.start);
  });
});

/**
 * Indexes of the spoken words the transcript got right: longest common subsequence of the
 * normalized words, preferring pairs close in time among equally long alignments, so a repeated
 * short word ("la", "esto") is paired with the right occurrence.
 */
function align(heard: readonly Word[], truth: readonly { text: string; startMs: number }[]): Set<number> {
  const a = heard.map((w) => ({ text: normalizeWord(w.text), at: w.start }));
  const b = truth.map((w) => ({ text: normalizeWord(w.text), at: w.startMs }));
  type Cell = { count: number; cost: number };
  const better = (x: Cell, y: Cell) => x.count > y.count || (x.count === y.count && x.cost < y.cost);
  const dp: Cell[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => ({ count: 0, cost: 0 })));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let best = better(dp[i - 1]![j]!, dp[i]![j - 1]!) ? dp[i - 1]![j]! : dp[i]![j - 1]!;
      if (a[i - 1]!.text !== "" && a[i - 1]!.text === b[j - 1]!.text) {
        const match = { count: dp[i - 1]![j - 1]!.count + 1, cost: dp[i - 1]![j - 1]!.cost + Math.abs(a[i - 1]!.at - b[j - 1]!.at) };
        if (!better(best, match)) best = match;
      }
      dp[i]![j] = best;
    }
  }
  const matched = new Set<number>();
  for (let i = a.length, j = b.length; i > 0 && j > 0; ) {
    const cell = dp[i]![j]!;
    const diag = dp[i - 1]![j - 1]!;
    if (a[i - 1]!.text === b[j - 1]!.text && a[i - 1]!.text !== "" && cell.count === diag.count + 1 &&
        cell.cost === diag.cost + Math.abs(a[i - 1]!.at - b[j - 1]!.at)) {
      matched.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1]![j]! === cell || (dp[i - 1]![j]!.count === cell.count && dp[i - 1]![j]!.cost === cell.cost)) {
      i--;
    } else {
      j--;
    }
  }
  return matched;
}
