import { describe, expect, it } from "vitest";
import { modelKey, SPEECH_MODELS } from "./speech-model";
import { DEFAULT_STATS, learnFromRun, parseStats, statsFor } from "./stats";

const FAST = SPEECH_MODELS.fast;
const ACCURATE = SPEECH_MODELS.accurate;
const FAST_KEY = modelKey(FAST);
const ACCURATE_KEY = modelKey(ACCURATE);

describe("learnFromRun", () => {
  it("learns the transcription speed on the first run, but not its load time (a download)", () => {
    const next = learnFromRun(DEFAULT_STATS, FAST, { audioMs: 20_000, loadMs: 9_000, transcribeMs: 4_000 }, "es");
    expect(next).toEqual({
      models: { [FAST_KEY]: { speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true } },
      lastLanguage: "es",
    });
  });

  it("blends later runs half and half, load time included", () => {
    const stats = { models: { [FAST_KEY]: { speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true } }, lastLanguage: "es" };
    expect(learnFromRun(stats, FAST, { audioMs: 10_000, loadMs: 1_000, transcribeMs: 1_500 }, "en")).toEqual({
      models: { [FAST_KEY]: { speed: { loadMs: 1_500, msPerAudioSecond: 200 }, modelReady: true } },
      lastLanguage: "en",
    });
  });

  it("does not learn a speed from very short audio, and keeps the last language when none is known", () => {
    const stats = { models: { [FAST_KEY]: { speed: { loadMs: 2_000, msPerAudioSecond: 250 }, modelReady: true } }, lastLanguage: "es" };
    const next = learnFromRun(stats, FAST, { audioMs: 2_000, loadMs: 2_000, transcribeMs: 3_000 }, undefined);
    expect(statsFor(next, FAST).speed.msPerAudioSecond).toBe(250);
    expect(next.lastLanguage).toBe("es");
  });

  it("keeps each model's speed and download apart: Accurate is a download of its own", () => {
    const fastOnly = learnFromRun(DEFAULT_STATS, FAST, { audioMs: 20_000, loadMs: 9_000, transcribeMs: 4_000 }, "es");
    expect(statsFor(fastOnly, ACCURATE)).toEqual({ speed: ACCURATE.defaultSpeed, modelReady: false });
    const both = learnFromRun(fastOnly, ACCURATE, { audioMs: 20_000, loadMs: 30_000, transcribeMs: 16_000 }, "es");
    expect(statsFor(both, ACCURATE).modelReady).toBe(true);
    expect(statsFor(both, ACCURATE).speed.loadMs).toBe(ACCURATE.defaultSpeed.loadMs);
    expect(statsFor(both, FAST)).toEqual(statsFor(fastOnly, FAST));
  });
});

describe("parseStats", () => {
  it("falls back field by field", () => {
    expect(parseStats(undefined)).toEqual(DEFAULT_STATS);
    expect(parseStats({ models: { [ACCURATE_KEY]: { speed: { loadMs: -1, msPerAudioSecond: 900 }, modelReady: true } }, lastLanguage: "" })).toEqual({
      models: { [ACCURATE_KEY]: { speed: { loadMs: ACCURATE.defaultSpeed.loadMs, msPerAudioSecond: 900 }, modelReady: true } },
    });
  });

  it("reads stats saved before the quality setting as whisper-base's", () => {
    expect(parseStats({ speed: { loadMs: 1_000, msPerAudioSecond: 180 }, modelReady: true, lastLanguage: "es" })).toEqual({
      models: { [FAST_KEY]: { speed: { loadMs: 1_000, msPerAudioSecond: 180 }, modelReady: true } },
      lastLanguage: "es",
    });
  });
});
