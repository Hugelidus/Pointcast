import { describe, expect, it } from "vitest";
import { DEFAULT_STATS, learnFromRun, parseStats } from "./stats";

describe("learnFromRun", () => {
  it("learns the transcription speed on the first run, but not its load time (a download)", () => {
    const next = learnFromRun(DEFAULT_STATS, { audioMs: 20_000, loadMs: 9_000, transcribeMs: 4_000 }, "es");
    expect(next).toEqual({ speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true, lastLanguage: "es" });
  });

  it("blends later runs half and half, load time included", () => {
    const stats = { speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true, lastLanguage: "es" };
    expect(learnFromRun(stats, { audioMs: 10_000, loadMs: 1_000, transcribeMs: 1_500 }, "en")).toEqual({
      speed: { loadMs: 1_500, msPerAudioSecond: 200 },
      modelReady: true,
      lastLanguage: "en",
    });
  });

  it("does not learn a speed from very short audio, and keeps the last language when none is known", () => {
    const stats = { speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true, lastLanguage: "es" };
    const next = learnFromRun(stats, { audioMs: 2_000, loadMs: 2_000, transcribeMs: 3_000 }, undefined);
    expect(next.speed.msPerAudioSecond).toBe(250);
    expect(next.lastLanguage).toBe("es");
  });
});

describe("parseStats", () => {
  it("falls back field by field", () => {
    expect(parseStats(undefined)).toEqual(DEFAULT_STATS);
    expect(parseStats({ speed: { loadMs: -1, msPerAudioSecond: 180 }, modelReady: true, lastLanguage: "" })).toEqual({
      speed: { loadMs: DEFAULT_STATS.speed.loadMs, msPerAudioSecond: 180 },
      modelReady: true,
    });
  });
});
