import { describe, expect, it, vi } from "vitest";
import { throttleProgress } from "./throttle";

describe("throttleProgress", () => {
  it("forwards every stage change, and repeats of a stage at most once per interval", () => {
    let now = 0;
    const forward = vi.fn();
    const report = throttleProgress(forward, 250, () => now);
    const bytes = (loadedBytes: number) => ({ stage: "loading-model" as const, model: "m", loadedBytes, totalBytes: 100 });

    report(bytes(0));
    now = 100;
    report(bytes(10));
    now = 300;
    report(bytes(50));
    now = 310;
    report({ stage: "model-ready", model: "m" });

    expect(forward.mock.calls.map(([p]) => p.stage === "loading-model" ? p.loadedBytes : p.stage)).toEqual([0, 50, "model-ready"]);
  });
});
