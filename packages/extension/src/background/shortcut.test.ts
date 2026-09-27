import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../messages";
import { TOGGLE_RECORDING_COMMAND, UNDO_EVENT_COMMAND } from "../shortcut";
import { createShortcutHandler } from "./shortcut";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createShortcutHandler", () => {
  it("runs the toggle for the Record/Stop command only", async () => {
    const toggle = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
    const onCommand = createShortcutHandler({ [TOGGLE_RECORDING_COMMAND]: toggle });

    expect(await onCommand("some-other-command")).toBeUndefined();
    expect(toggle).not.toHaveBeenCalled();
    expect(await onCommand(TOGGLE_RECORDING_COMMAND)).toEqual({ ok: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("runs each command's own handler, and one command running does not block the other", async () => {
    let finishToggle: (() => void) | undefined;
    const toggle = vi.fn(() => new Promise<CommandResult>((resolve) => (finishToggle = () => resolve({ ok: true }))));
    const undo = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
    const onCommand = createShortcutHandler({ [TOGGLE_RECORDING_COMMAND]: toggle, [UNDO_EVENT_COMMAND]: undo });

    const pending = onCommand(TOGGLE_RECORDING_COMMAND);
    expect(await onCommand(UNDO_EVENT_COMMAND)).toEqual({ ok: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(await onCommand("toString")).toBeUndefined();
    finishToggle?.();
    expect(await pending).toEqual({ ok: true });
  });

  it("ignores presses while the previous one is still being handled, then accepts the next", async () => {
    let finish: (() => void) | undefined;
    const toggle = vi.fn(
      () => new Promise<CommandResult>((resolve) => (finish = () => resolve({ ok: true }))),
    );
    const onCommand = createShortcutHandler({ [TOGGLE_RECORDING_COMMAND]: toggle });

    const first = onCommand(TOGGLE_RECORDING_COMMAND);
    // Key repeat or a double press: two starts must not race past the "idle" check.
    expect(await onCommand(TOGGLE_RECORDING_COMMAND)).toBeUndefined();
    expect(toggle).toHaveBeenCalledTimes(1);

    finish?.();
    expect(await first).toEqual({ ok: true });
    void onCommand(TOGGLE_RECORDING_COMMAND);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("reports a failure instead of rejecting, and accepts the next press", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const toggle = vi.fn(async (): Promise<CommandResult> => {
      throw new Error("storage unavailable");
    });
    const onCommand = createShortcutHandler({ [TOGGLE_RECORDING_COMMAND]: toggle });

    expect(await onCommand(TOGGLE_RECORDING_COMMAND)).toEqual({ ok: false, error: "storage unavailable" });
    await onCommand(TOGGLE_RECORDING_COMMAND);
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});
