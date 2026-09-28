import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./support/fixtures";
import { normalize, readSpokenWords } from "./support/ground-truth";
import { REPO_ROOT } from "./support/paths";
import { readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { sleepUntil } from "./support/scenario";
import { readMonoSamples } from "./support/wav-file";

/**
 * Benchmark, not a check: how long Stop → Markdown takes for a whole fixture narrated into the
 * fake microphone, and how many of its words come out right (SAPI ground truth). Measures the
 * time a user waits after Stop, with the model already in the Cache API (a warm-up session
 * loads it). Burns minutes of CPU, so it runs only when asked:
 *   POINTCAST_BENCH=1 pnpm exec playwright test --config dev/playwright.config.ts stop-latency
 */
const FIXTURES = ["es-short", "es-2min"];

for (const name of FIXTURES) {
  test.describe(name, () => {
    const wav = path.join(REPO_ROOT, "dev", "fixtures", "audio", `${name}.wav`);
    test.use({ microphoneFile: wav });
    test.skip(process.env["POINTCAST_BENCH"] !== "1", "benchmark: set POINTCAST_BENCH=1");

    test(`Stop → Markdown for ${name}`, async ({ extensionPage: popup, downloadsDir }) => {
      test.setTimeout(600_000);
      const { samples, sampleRate } = readMonoSamples(readFileSync(wav));
      const audioMs = (samples.length * 1000) / sampleRate;

      // Warm-up: the first session of a fresh profile also downloads the model.
      await startFromPopup(popup);
      await popup.waitForTimeout(3_000);
      await stopFromPopup(popup);

      const t0 = await startFromPopup(popup);
      await sleepUntil(t0 + audioMs + 200);
      const { stoppedAt, sessionId } = await stopFromPopup(popup);
      const stopToMarkdownMs = Date.now() - stoppedAt;

      const saved = await readSavedSession(popup, downloadsDir, sessionId);
      const truth = readSpokenWords(path.join(REPO_ROOT, "dev", "fixtures", "audio", `${name}.words.json`)).map((w) => normalize(w.text)).filter((w) => w !== "");
      const heard = saved.words.words.map((w) => normalize(w.text)).filter((w) => w !== "");
      const accuracy = commonWords(heard, truth) / truth.length;
      console.log(
        `BENCH ${name}: ${(audioMs / 1000).toFixed(1)} s of audio, Stop → Markdown ${stopToMarkdownMs} ms, ` +
          `${heard.length} words, ${(accuracy * 100).toFixed(1)} % of the ${truth.length} spoken words right`,
      );
      expect(accuracy).toBeGreaterThan(0.8);
    });
  });
}

/** Longest common subsequence length: words right, in order. */
function commonWords(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) {
      row[j] = word === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    }
    previous = row;
  }
  return previous[b.length]!;
}
