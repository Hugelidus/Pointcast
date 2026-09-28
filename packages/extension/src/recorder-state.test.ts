import { describe, expect, it } from "vitest";
import { IDLE_STATE, isRecording, parseLastEvent, parseState, savedLocationText, toggleCommand } from "./recorder-state";

describe("parseState", () => {
  it("falls back to idle for missing or malformed values", () => {
    expect(parseState(undefined)).toEqual(IDLE_STATE);
    expect(parseState(null)).toEqual(IDLE_STATE);
    expect(parseState({ status: "paused" })).toEqual(IDLE_STATE);
  });

  it("keeps a valid state as is", () => {
    const state = { status: "recording", t0: 1000 };
    expect(parseState(state)).toBe(state);
    expect(isRecording(parseState(state))).toBe(true);
  });
});

describe("toggleCommand (popup button and keyboard shortcut)", () => {
  it("stops while recording and starts otherwise", () => {
    expect(toggleCommand({ status: "recording", t0: 1 })).toBe("stop");
    expect(toggleCommand({ status: "idle" })).toBe("start");
    // Refused by the service worker in a busy state: nothing starts twice.
    expect(toggleCommand({ status: "starting" })).toBe("start");
    expect(toggleCommand({ status: "stopping", t0: 1 })).toBe("start");
  });
});

describe("parseLastEvent", () => {
  it("keeps a summary and treats anything else as none", () => {
    expect(parseLastEvent("button «Export» · Alt+click")).toBe("button «Export» · Alt+click");
    for (const value of [undefined, null, "", 3, {}]) expect(parseLastEvent(value)).toBeUndefined();
  });
});

describe("savedLocationText", () => {
  it("names the Downloads folder, or the folder a pointcast MCP server reported", () => {
    expect(savedLocationText("2026-09-28_10-15-00")).toBe("Saved to Downloads/pointcast/2026-09-28_10-15-00/");
    expect(savedLocationText("2026-09-28_10-15-00", "~/Downloads/pointcast/2026-09-28_10-15-00")).toBe(
      "Saved by the Pointcast MCP server to ~/Downloads/pointcast/2026-09-28_10-15-00",
    );
  });
});
