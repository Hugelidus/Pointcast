import { describe, expect, it } from "vitest";
import { formatSessionId, nextFreeSessionId } from "./session-id";

describe("formatSessionId", () => {
  it("uses local time with zero padding", () => {
    // The Date constructor with components is interpreted in local time, like the formatter.
    expect(formatSessionId(new Date(2026, 8, 6, 7, 5, 3))).toBe("2026-09-06_07-05-03");
  });

  it("sorts chronologically as text", () => {
    const a = formatSessionId(new Date(2026, 8, 26, 9, 59, 59));
    const b = formatSessionId(new Date(2026, 8, 26, 10, 0, 0));
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe("nextFreeSessionId", () => {
  it("keeps the timestamp id when it is free", () => {
    expect(nextFreeSessionId("2026-09-26_18-30-05", new Set())).toBe("2026-09-26_18-30-05");
  });

  it("adds a suffix when a session in the same second already used the folder", () => {
    expect(nextFreeSessionId("2026-09-26_18-30-05", new Set(["2026-09-26_18-30-05"]))).toBe("2026-09-26_18-30-05-2");
    expect(
      nextFreeSessionId("2026-09-26_18-30-05", new Set(["2026-09-26_18-30-05", "2026-09-26_18-30-05-2"])),
    ).toBe("2026-09-26_18-30-05-3");
  });

  it("still sorts chronologically as text", () => {
    const ids = ["2026-09-26_18-30-06", "2026-09-26_18-30-05-2", "2026-09-26_18-30-05"];
    expect([...ids].sort()).toEqual(["2026-09-26_18-30-05", "2026-09-26_18-30-05-2", "2026-09-26_18-30-06"]);
  });
});
