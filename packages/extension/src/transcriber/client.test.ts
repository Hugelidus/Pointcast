import { describe, expect, it } from "vitest";
import { transcriptionThreads } from "./client";

describe("transcriptionThreads", () => {
  it("uses half the logical cores, between 1 and 8", () => {
    expect(transcriptionThreads(24)).toBe(8);
    expect(transcriptionThreads(8)).toBe(4);
    expect(transcriptionThreads(1)).toBe(1);
  });
});
