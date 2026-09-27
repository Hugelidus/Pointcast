// When each gesture of a scenario happens: at the start of its word in the narration WAV.
import { readFileSync } from "node:fs";
import path from "node:path";
import { SCENARIOS_DIR } from "./apps.mjs";

/** Lowercase, no accents, no punctuation (as e2e/support/ground-truth.ts): "Esta," = "esta". */
export function normalize(/** @type {string} */ word) {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/** narration.words.json written by scripts/tts/generate.ps1 -ScriptJson. */
export function readNarration(/** @type {string} */ app) {
  const dir = path.join(SCENARIOS_DIR, app);
  const words = JSON.parse(readFileSync(path.join(dir, "narration.words.json"), "utf8"));
  return { wav: path.join(dir, "narration.wav"), text: words.text, words: words.words };
}

/**
 * Each gesture with `atMs`, the start of the n-th occurrence of its word (ms from the WAV start).
 * @param {{ word: string, occurrence?: number }[]} gestures
 * @param {{ text: string, startMs: number }[]} words
 */
export function scheduleGestures(gestures, words) {
  const scheduled = gestures.map((g) => {
    const starts = words.filter((w) => normalize(w.text) === normalize(g.word)).map((w) => w.startMs);
    const atMs = starts[(g.occurrence ?? 1) - 1];
    if (atMs === undefined) throw new Error(`the narration does not say "${g.word}" ${g.occurrence ?? 1} time(s)`);
    return { ...g, atMs };
  });
  scheduled.forEach((g, i) => {
    const prev = scheduled[i - 1];
    if (prev && g.atMs <= prev.atMs) throw new Error(`gesture ${i + 1} ("${g.word}") is not after gesture ${i}`);
  });
  return scheduled;
}
