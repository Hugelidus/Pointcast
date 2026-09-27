import { describe, expect, it } from "vitest";
import type { RecorderState } from "../recorder-state";
import {
  formatElapsed,
  lastEventText,
  popupView,
  processingPanel,
  resultView,
  shortcutHint,
  siteView,
  tabCaptureView,
  undoShortcutHint,
  undoView,
} from "./view";

describe("popupView", () => {
  it("offers Record when idle and Stop while recording", () => {
    expect(popupView({ status: "idle" })).toMatchObject({ buttonText: "Record", buttonEnabled: true, message: null });
    expect(popupView({ status: "recording", t0: 1 })).toMatchObject({
      statusText: "Recording",
      buttonText: "Stop",
      buttonEnabled: true,
    });
  });

  it("disables the button during transitions and while processing", () => {
    expect(popupView({ status: "starting" }).buttonEnabled).toBe(false);
    expect(popupView({ status: "stopping", t0: 1 }).buttonEnabled).toBe(false);
    expect(popupView({ status: "processing", t0: 1 })).toMatchObject({
      statusText: "Processing…",
      buttonText: "Record",
      buttonEnabled: false,
    });
  });

  it("says the Markdown is on the clipboard when it is", () => {
    const state: RecorderState = {
      status: "idle",
      lastSessionId: "s1",
      lastResult: { sessionId: "s1", finishedAt: 1, copied: true, audioMs: 12_000, processingMs: 5_000 },
    };
    expect(popupView(state).message).toEqual({
      text: "Copied — paste it into your agent. Saved to Downloads/pointcast/s1/",
      isError: false,
    });
  });

  it("tells where the last session was saved, unless there is an error", () => {
    expect(popupView({ status: "idle", lastSessionId: "2026-09-26_18-30-05" }).message).toEqual({
      text: "Saved to Downloads/pointcast/2026-09-26_18-30-05/",
      isError: false,
    });
    expect(popupView({ status: "idle", lastSessionId: "x", error: "Boom" }).message).toEqual({
      text: "Boom",
      isError: true,
    });
  });

  it("shows a warning about a session that was saved anyway", () => {
    expect(popupView({ status: "idle", lastSessionId: "x", warning: "Audio kept as audio.webm." }).message).toEqual({
      text: "Saved to Downloads/pointcast/x/ Audio kept as audio.webm.",
      isError: true,
    });
  });
});

describe("tabCaptureView", () => {
  const idle = { status: "idle" } as const;
  const recording = { status: "recording", t0: 1 } as const;

  it("says the tab is being checked until the service worker answers", () => {
    expect(tabCaptureView(undefined, idle)).toEqual({ text: "Checking this tab…", tone: "muted" });
  });

  it("confirms a tab with a live content script", () => {
    expect(tabCaptureView({ status: "attached" }, idle)).toEqual({
      text: "This tab will be captured when you record.",
      tone: "ok",
    });
    expect(tabCaptureView({ status: "attached" }, recording)).toEqual({ text: "Capturing this tab.", tone: "ok" });
  });

  it("explains that other hosts are never captured, as an error while recording", () => {
    const view = tabCaptureView({ status: "not-local" }, idle);
    expect(view.text).toBe(
      "This tab is not captured: pointcast only runs on local dev hosts (localhost, *.localhost, 127.0.0.1, [::1], *.test), not on file:// pages or remote sites.",
    );
    expect(view.tone).toBe("warning");
    expect(tabCaptureView({ status: "not-local" }, recording).tone).toBe("error");
    expect(tabCaptureView({ status: "not-local" }, { status: "starting" }).tone).toBe("error");
  });

  it("shows why a local tab could not be attached", () => {
    const capture = { status: "unavailable", error: "Frame with ID 0 is showing error page" } as const;
    expect(tabCaptureView(capture, recording)).toEqual({
      text: "This tab is not captured: pointcast could not attach to it (Frame with ID 0 is showing error page). Reload the page.",
      tone: "error",
    });
    expect(tabCaptureView(capture, idle).tone).toBe("warning");
  });
});

describe("lastEventText", () => {
  it("shows the last captured element while recording", () => {
    expect(lastEventText({ status: "recording", t0: 1 }, "button «Export» · Alt+click")).toBe(
      "Last: button «Export» · Alt+click",
    );
  });

  it("shows nothing before the first event, or when not recording", () => {
    expect(lastEventText({ status: "recording", t0: 1 }, undefined)).toBeNull();
    for (const status of ["idle", "starting", "stopping"] as const) {
      expect(lastEventText({ status }, "button «Export» · Alt+click")).toBeNull();
    }
  });
});

describe("shortcutHint", () => {
  it("names the binding as Chrome reports it: localized, per platform, or as the user changed it", () => {
    expect(shortcutHint("Alt+Shift+S")).toBe("Alt+Shift+S starts or stops recording without opening this popup.");
    expect(shortcutHint("Alt+Mayús+S")).toBe("Alt+Mayús+S starts or stops recording without opening this popup.");
    expect(shortcutHint("⌥⇧S")).toBe("⌥⇧S starts or stops recording without opening this popup.");
  });

  it("says where to set one when the command has no binding", () => {
    expect(shortcutHint("")).toBe("No keyboard shortcut for Record/Stop: set one in chrome://extensions/shortcuts.");
  });

  it("hides the line when the command is unknown", () => {
    expect(shortcutHint(undefined)).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("formats minutes and seconds, and hours when needed", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_999)).toBe("01:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-500)).toBe("00:00");
  });
});

describe("processingPanel", () => {
  const info = { startedAt: 1_000, audioMs: 12_000, estimatedEnd: 11_000, deadline: 999_999, firstRun: false } as const;

  it("shows the estimate while stopping and processing, and nothing otherwise", () => {
    const panel = processingPanel({ status: "processing", processing: { ...info, stage: "transcribing" } }, 6_000);
    expect(panel).toMatchObject({ text: "Processing… ~0:05", fraction: 0.5 });
    expect(panel?.detail).toMatch(/^0:12 of audio\. The time is estimated from earlier runs/);
    expect(processingPanel({ status: "idle" }, 6_000)).toBeNull();
  });

  it("explains the one-time model download on the first run", () => {
    const panel = processingPanel(
      { status: "processing", processing: { ...info, firstRun: true, stage: "downloading-model", loadedBytes: 100e6, totalBytes: 291e6 } },
      6_000,
    );
    expect(panel?.text).toBe("Downloading the speech model (first time only)… 100 / 291 MB");
    expect(panel?.detail).toMatch(/downloaded once \(291 MB\)/);
  });
});

describe("resultView", () => {
  const lastResult = { sessionId: "s1", finishedAt: 1, copied: true, downloadId: 7, audioMs: 12_000, processingMs: 6_400 };

  it("offers Copy again and Show in folder after a good run, with how long it took", () => {
    expect(resultView({ status: "idle", lastSessionId: "s1", lastResult }, true)).toEqual({
      copyAgain: true,
      showInFolder: 7,
      timing: "0:12 of audio processed in 0:07.",
      code: null,
    });
  });

  it("adds one line on how the code pointers resolved against the dev server, success or not", () => {
    const code = "Code pointer: dev server source not available (not a Vite dev server).";
    expect(resultView({ status: "idle", lastSessionId: "s1", lastResult: { ...lastResult, code } }, true)?.code).toBe(code);
  });

  it("does not offer to copy a failed session's (or a missing) Markdown", () => {
    expect(resultView({ status: "idle", lastResult, error: "Could not transcribe." }, true)?.copyAgain).toBe(false);
    expect(resultView({ status: "idle", lastResult }, false)?.copyAgain).toBe(false);
    expect(resultView({ status: "recording", t0: 1, lastResult }, true)).toBeNull();
  });
});

describe("site section", () => {
  it("offers to enable a remote site, says Chrome will ask, and that personal data is redacted", () => {
    const view = siteView({ host: "example.com", enabled: false });
    expect(view?.button).toBe("Enable on example.com");
    expect(view?.note).toContain("example.com only");
    expect(view?.note).toContain("redacted");
    expect(tabCaptureView({ status: "not-local" }, { status: "idle" }, "example.com").text).toBe(
      "This tab is not captured: pointcast is off on example.com.",
    );
  });

  it("offers to remove an enabled site, and is hidden elsewhere", () => {
    const view = siteView({ host: "example.com", enabled: true });
    expect(view?.button).toBe("Remove example.com");
    expect(view?.note).toMatch(/^Enabled on example\.com\. .*redacted/);
    expect(siteView(undefined)).toBeNull();
  });
});

describe("undo", () => {
  it("is shown while recording, and enabled once a gesture was captured", () => {
    expect(undoView({ status: "idle" }, 3)).toEqual({ visible: false, enabled: false });
    expect(undoView({ status: "recording", t0: 1 }, 0)).toEqual({ visible: true, enabled: false });
    expect(undoView({ status: "recording", t0: 1 }, 2)).toEqual({ visible: true, enabled: true });
  });

  it("names the Undo shortcut Chrome has, and says nothing when there is none", () => {
    expect(undoShortcutHint("Alt+Mayús+U")).toBe("Alt+Mayús+U undoes the last gesture.");
    expect(undoShortcutHint("")).toBeNull();
    expect(undoShortcutHint(undefined)).toBeNull();
  });
});
