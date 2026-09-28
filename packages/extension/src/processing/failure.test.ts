import { describe, expect, it } from "vitest";
import { errorDetailOf, explainTranscriptionFailure, firstSentence, SAVED_NOTE, transcriptionFailureKind } from "./failure";

describe("transcriptionFailureKind", () => {
  it.each([
    ['Could not locate file: "http://127.0.0.1:5541/Xenova/whisper-base/config.json".', "model-download"],
    ['Error (503) occurred while trying to load file: "https://huggingface.co/x/onnx/decoder.onnx".', "model-download"],
    ["Failed to fetch", "model-download"],
    ["NetworkError when attempting to fetch resource.", "model-download"],
    ["RangeError: Array buffer allocation failed", "memory"],
    ["WebAssembly.Memory(): could not allocate memory", "memory"],
    ["Aborted(OOM)", "memory"],
    ["failed to allocate a buffer of size 1048576", "memory"],
    ["Transcription took too long and was stopped.", "timeout"],
    ["The transcription worker failed to start.", "other"],
    ["something else", "other"],
  ] as const)("%s → %s", (raw, kind) => {
    expect(transcriptionFailureKind(raw)).toBe(kind);
  });
});

describe("explainTranscriptionFailure", () => {
  it("says what to do in the first sentence and that nothing was lost, without the raw text", () => {
    const raw = 'Could not locate file: "http://127.0.0.1:5541/Xenova/whisper-base/config.json".';
    const explained = explainTranscriptionFailure(raw);
    expect(explained.kind).toBe("model-download");
    expect(firstSentence(explained.error, 200)).toBe(
      "Could not download the speech model: check your internet connection, then record again.",
    );
    expect(explained.error.endsWith(SAVED_NOTE)).toBe(true);
    expect(explained.error).not.toContain("http");
    expect(explained.errorDetail.startsWith(raw)).toBe(true);
    expect(explained.errorDetail).toContain('"pointcast process"');
  });

  it("names the memory problem and the way out", () => {
    expect(explainTranscriptionFailure("Aborted(OOM)").error).toMatch(/^Not enough memory to transcribe: close some tabs/);
  });

  it("never loses an unknown error: it stays in the detail", () => {
    const explained = explainTranscriptionFailure("  weird engine state  ");
    expect(explained.error).toMatch(/^Could not transcribe the recording: /);
    expect(explained.errorDetail.startsWith("weird engine state\n")).toBe(true);
  });
});

describe("errorDetailOf", () => {
  it("is the detail only while there is an error", () => {
    expect(errorDetailOf({ status: "idle", error: "x", errorDetail: "raw" })).toBe("raw");
    expect(errorDetailOf({ status: "idle", errorDetail: "stale" })).toBeUndefined();
  });
});

describe("firstSentence", () => {
  it("stops at the end of the first sentence, not at a colon", () => {
    expect(firstSentence("One: two. Three.")).toBe("One: two.");
  });

  it("shortens a long sentence with an ellipsis", () => {
    const text = firstSentence("a".repeat(150));
    expect(text).toHaveLength(100);
    expect(text.endsWith("…")).toBe(true);
  });
});
