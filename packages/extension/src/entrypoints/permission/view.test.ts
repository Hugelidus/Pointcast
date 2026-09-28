import { describe, expect, it } from "vitest";
import { GRANTED_TEXT, permissionView, stateAfterRequest } from "./view";

describe("permissionView", () => {
  it("asks with the one button until Chrome decided", () => {
    expect(permissionView({ kind: "prompt" })).toEqual({ allow: true, steps: false, back: false, result: null });
  });

  it("offers the way back to the app once allowed", () => {
    expect(permissionView({ kind: "granted" })).toEqual({
      allow: false,
      steps: false,
      back: true,
      result: { text: GRANTED_TEXT, tone: "ok" },
    });
    expect(GRANTED_TEXT).toContain("Pointcast popup");
  });

  it("shows the numbered steps and Check again when blocked, since Chrome no longer prompts", () => {
    const blocked = permissionView({ kind: "blocked", checkedAgain: false });
    expect(blocked).toMatchObject({ allow: false, steps: true, back: false, result: { tone: "error" } });
    expect(blocked.result?.text).toBe("Chrome blocked the microphone for Pointcast. To allow it:");
    expect(permissionView({ kind: "blocked", checkedAgain: true }).result?.text).toMatch(/^The microphone is still blocked\./);
  });

  it("keeps the button for another try after an error", () => {
    expect(permissionView({ kind: "error", message: "busy." })).toMatchObject({
      allow: true,
      result: { text: "Could not open the microphone: busy.", tone: "error" },
    });
  });
});

describe("stateAfterRequest", () => {
  it("tells a block from a missing microphone and from anything else", () => {
    expect(stateAfterRequest(new DOMException("denied", "NotAllowedError"))).toEqual({ kind: "blocked", checkedAgain: false });
    expect(stateAfterRequest(new DOMException("none", "NotFoundError"))).toEqual({
      kind: "error",
      message: "no microphone was found. Connect one and try again.",
    });
    expect(stateAfterRequest(new Error("Device in use"))).toEqual({ kind: "error", message: "Device in use." });
  });
});
