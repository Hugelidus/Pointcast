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

  it("makes up no estimate before the first model download reports its size", () => {
    expect(processingView({ ...info, stage: "stopping", firstRun: true }, 15_000)).toEqual({ text: "Preparing…", fraction: 0 });
    expect(processingView({ ...info, stage: "stopping" }, 15_000).text).toBe("Processing… ~0:15");
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

  it("says the Markdown was copied, and where it went, for a few seconds", () => {
    expect(pillView(finished({}), 101_000)).toEqual({ kind: "done", text: "✓ Copied · saved to Downloads" });
    const handedOff = finished({});
    if (handedOff.lastResult) handedOff.lastResult.handedOffTo = "~/Downloads/pointcast/s";
    expect(pillView(handedOff, 101_000)).toEqual({ kind: "done", text: "✓ Copied · sent to your agent" });
    expect(pillView(finished({}, false), 101_000)).toEqual({ kind: "done", text: "✓ Saved · copy it from the Pointcast popup" });
    expect(pillView(finished({}), 100_000 + DONE_VISIBLE_MS)).toBeNull();
  });

  it("marks a success with a warning, a little longer", () => {
    const warned = finished({ warning: "Not sent to the Pointcast MCP server: it refused this recording (disk full)." });
    expect(pillView(warned, 106_000)).toEqual({ kind: "warning", text: "✓ Copied, with a warning. See the Pointcast popup." });
    expect(pillView(warned, 100_000 + ERROR_VISIBLE_MS)).toBeNull();
  });

  it("shows the first sentence of an error a little longer", () => {
    const failed = finished({ error: "Saving session s failed; see chrome://downloads. More." });
    expect(pillView(failed, 105_000)).toEqual({
      kind: "error",
      text: "✗ Saving session s failed; see chrome://downloads. See the Pointcast popup.",
    });
    expect(pillView(failed, 100_000 + ERROR_VISIBLE_MS)).toBeNull();
  });

  it("only says that transcription failed: the popup explains why", () => {
    const failed = finished({
      error: "Could not download the speech model: check your internet connection, then record again. Your events and audio are saved.",
      errorKind: "transcription",
    });
    expect(pillView(failed, 105_000)).toEqual({ kind: "error", text: "✗ Could not transcribe. See the Pointcast popup." });
  });

  it("says why Record did nothing, although no session ended", () => {
    const denied: RecorderState = { status: "idle", error: "…", errorKind: "microphone-denied", startFailedAt: 50_000 };
    expect(pillView(denied, 51_000)).toEqual({
      kind: "error",
      text: "✗ Pointcast needs the microphone: allow it in the tab that just opened.",
    });
    expect(pillView({ ...denied, errorKind: "start" }, 51_000)).toEqual({
      kind: "error",
      text: "✗ Recording did not start. See the Pointcast popup.",
    });
    expect(pillView(denied, 50_000 + ERROR_VISIBLE_MS)).toBeNull();
  });
});
