import { describe, expect, it } from "vitest";
import type { RecorderState } from "../recorder-state";
import {
  DONE_VISIBLE_MS,
  ERROR_VISIBLE_MS,
  formatDuration,
  pillView,
  processingEstimateMs,
  processingView,
  type ProcessingInfo,
} from "./progress";

const info: ProcessingInfo = {
  startedAt: 10_000,
  audioMs: 12_000,
  stage: "transcribing",
  estimatedEnd: 30_000,
  deadline: 999_999,
  firstRun: false,
};

describe("processingEstimateMs", () => {
  it("adds the cached model load, except on the first run whose download is shown in MB", () => {
    const speed = { loadMs: 2_000, msPerAudioSecond: 300 };
    expect(processingEstimateMs(12_000, speed, false)).toBe(1_000 + 2_000 + 500 + 3_600);
    expect(processingEstimateMs(12_000, speed, true)).toBe(1_000 + 500 + 3_600);
  });
});

describe("processingView", () => {
  it("counts down the estimate and fills the bar with the elapsed share", () => {
    expect(processingView(info, 15_000)).toEqual({ text: "Processing… ~0:15", fraction: 0.25 });
  });

  it("never reaches 100 % before the files are saved, even past the estimate", () => {
    expect(processingView(info, 29_990).fraction).toBeLessThanOrEqual(0.95);
    expect(processingView(info, 45_000)).toEqual({ text: "Processing… almost done", fraction: 0.95 });
    expect(processingView({ ...info, stage: "saving" }, 45_000)).toEqual({ text: "Saving…", fraction: 0.95 });
  });

  it("shows the first model download in MB", () => {
    const downloading = { ...info, stage: "downloading-model" as const, firstRun: true };
    expect(processingView(downloading, 15_000)).toEqual({ text: "Downloading the speech model (first time only)…", fraction: 0 });
    expect(processingView({ ...downloading, loadedBytes: 145.5e6, totalBytes: 291e6 }, 15_000)).toEqual({
      text: "Downloading the speech model (first time only)… 146 / 291 MB",
      fraction: 0.475,
    });
  });
});

describe("formatDuration", () => {
  it("formats m:ss and rounds up, so the last second is never ~0:00", () => {
    expect(formatDuration(25_000)).toBe("0:25");
    expect(formatDuration(65_001)).toBe("1:06");
    expect(formatDuration(10)).toBe("0:01");
  });
});

describe("pillView", () => {
  const finished = (extra: Partial<RecorderState>, copied = true): RecorderState => ({
    status: "idle",
    lastSessionId: "s",
    lastResult: { sessionId: "s", finishedAt: 100_000, copied, audioMs: 12_000, processingMs: 5_000 },
    ...extra,
  });

  it("follows the recording and the processing", () => {
    expect(pillView({ status: "recording", t0: 1 }, 0)).toEqual({ kind: "recording" });
    expect(pillView({ status: "processing", processing: info }, 15_000)).toEqual({
      kind: "processing",
      text: "Processing… ~0:15",
      fraction: 0.25,
    });
    expect(pillView({ status: "idle" }, 0)).toBeNull();
  });

  it("says the Markdown was copied for a few seconds", () => {
    expect(pillView(finished({}), 101_000)).toEqual({ kind: "done", text: "✓ Copied — paste it into your agent" });
    expect(pillView(finished({}, false), 101_000)).toEqual({ kind: "done", text: "✓ Saved — copy it from the pointcast popup" });
    expect(pillView(finished({}), 100_000 + DONE_VISIBLE_MS)).toBeNull();
  });

  it("shows the first sentence of an error a little longer", () => {
    const failed = finished({ error: "Could not transcribe: offline. The events and the audio were saved." });
    expect(pillView(failed, 105_000)).toEqual({
      kind: "error",
      text: "✗ Could not transcribe: offline. Details in the pointcast popup.",
    });
    expect(pillView(failed, 100_000 + ERROR_VISIBLE_MS)).toBeNull();
  });
});
