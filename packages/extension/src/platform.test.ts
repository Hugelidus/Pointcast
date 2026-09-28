import { describe, expect, it } from "vitest";
import { isMac, pointGestureName } from "./platform";

describe("isMac", () => {
  it("reads userAgentData first, then navigator.platform and the user agent", () => {
    expect(isMac({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isMac({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).toBe(false);
    expect(isMac({ userAgentData: { platform: "Linux" } })).toBe(false);
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ platform: "Win32" })).toBe(false);
    expect(isMac({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" })).toBe(true);
    expect(isMac({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" })).toBe(false);
    expect(isMac({})).toBe(false);
  });
});

describe("pointGestureName", () => {
  it("names the key a Mac keyboard shows", () => {
    expect(pointGestureName(true)).toBe("⌥ Option+click");
    expect(pointGestureName(false)).toBe("Alt+click");
  });
});
