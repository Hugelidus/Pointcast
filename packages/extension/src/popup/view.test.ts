import { describe, expect, it } from "vitest";
import { SPEECH_MODEL_MB, type ProcessingInfo } from "../processing/progress";
import type { RecorderState } from "../recorder-state";
import {
  firstRunNotice,
  formatElapsed,
  friendlyEvent,
  lastEventText,
  metaLine,
  modeView,
  pointingHint,
  popupView,
  processingPanel,
  recordingTimeMs,
  resultView,
  shortPath,
  shortcutHint,
  siteView,
  splitLead,
  stageAnnouncement,
  tabCaptureView,
  undoneText,
  undoView,
} from "./view";

describe("popupView", () => {
  it("offers Record when idle and Stop while recording", () => {
    expect(popupView({ status: "idle" })).toMatchObject({
      button: { text: "Record", kind: "record", action: "start", visible: true, enabled: true },
      message: null,
    });
    expect(popupView({ status: "recording", t0: 1 })).toMatchObject({
      statusText: "Recording",
      button: { text: "Stop", kind: "stop", action: "stop", visible: true, enabled: true },
    });
  });

  it("disables the button while starting, and hides it while stopping and processing", () => {
    expect(popupView({ status: "starting" }).button).toMatchObject({ visible: true, enabled: false });
    for (const status of ["stopping", "processing"] as const) {
      const view = popupView({ status, t0: 1 });
      expect(view.button).toMatchObject({ visible: false, enabled: false });
      // The tab line would invite recording again while the last recording is still processed.
      expect(view.showTab).toBe(false);
    }
    expect(popupView({ status: "processing" }).statusText).toBe("Processing…");
  });

  describe("the microphone (decision E)", () => {
    it("asks for the microphone instead of Record until Chrome has the grant", () => {
      for (const microphone of ["prompt", "denied"] as const) {
        expect(popupView({ status: "idle" }, { microphone }).button).toEqual({
          text: "Allow microphone",
          kind: "primary",
          action: "allow-microphone",
          visible: true,
          enabled: true,
        });
      }
    });

    it("offers Record once granted, or when the browser cannot tell", () => {
      expect(popupView({ status: "idle" }, { microphone: "granted" }).button.action).toBe("start");
      expect(popupView({ status: "idle" }, {}).button.action).toBe("start");
    });

    it("never turns Stop into Allow microphone", () => {
      expect(popupView({ status: "recording", t0: 1 }, { microphone: "denied" }).button.action).toBe("stop");
    });
  });

  it("makes Record secondary on a remote site that is not enabled, and says it captures nothing there", () => {
    expect(popupView({ status: "idle" }, { offSite: true }).button).toMatchObject({
      text: "Record (this tab won't be captured)",
      kind: "secondary",
      action: "start",
    });
  });

  it("shows the Time and Events cards only while recording, and the hints only before and while recording", () => {
    expect(popupView({ status: "recording", t0: 1 })).toMatchObject({ showStats: true, showHints: true });
    expect(popupView({ status: "idle" })).toMatchObject({ showStats: false, showHints: true });
    expect(popupView({ status: "processing" })).toMatchObject({ showStats: false, showHints: false });
  });

  describe("the message (tone, not a boolean)", () => {
    const lastResult = { sessionId: "s1", finishedAt: 1, copied: true, audioMs: 12_000, processingMs: 5_000 };

    it("is a success headline when the Markdown was copied", () => {
      expect(popupView({ status: "idle", lastSessionId: "s1", lastResult }).message).toEqual({
        tone: "ok",
        text: "Copied. Paste it into your agent.",
      });
    });

    it("says Saved, or Sent to your agent, when nothing was copied", () => {
      expect(popupView({ status: "idle", lastSessionId: "s2" }).message).toEqual({ tone: "ok", text: "Saved." });
      const handedOff = { ...lastResult, copied: false, handedOffTo: "~/x" };
      expect(popupView({ status: "idle", lastSessionId: "s1", lastResult: handedOff }).message?.text).toBe("Sent to your agent.");
    });

    it("stays a success headline when there is a warning: the warning has its own amber line", () => {
      const state: RecorderState = { status: "idle", lastSessionId: "s1", lastResult, warning: "The MCP server refused it." };
      expect(popupView(state).message).toEqual({ tone: "ok", text: "Copied. Paste it into your agent." });
      expect(resultView(state, true)?.warning).toEqual({ lead: "The MCP server refused it.", body: "" });
    });

    it("is an error when the session failed, with the raw text kept for Details", () => {
      expect(popupView({ status: "idle", lastSessionId: "x", error: "Boom" })).toMatchObject({
        message: { tone: "error", text: "Boom" },
        details: null,
      });
      const failed: RecorderState = { status: "idle", error: "Could not download the speech model.", errorDetail: "Could not locate file" };
      expect(popupView(failed).details).toBe("Could not locate file");
      // A detail left from an error that is gone is not shown.
      expect(popupView({ status: "idle", errorDetail: "old" }).details).toBeNull();
    });
  });
});

describe("firstRunNotice", () => {
  it("explains the microphone and the one-time download before the first recording", () => {
    const notice = firstRunNotice({ status: "idle" }, "prompt", false);
    expect(notice?.title).toBe("Before your first recording");
    expect(notice?.text).toBe(
      `Pointcast needs the microphone once. The first Stop also downloads the speech model (${SPEECH_MODEL_MB} MB, once); transcription then runs on this computer.`,
    );
  });

  it("mentions only what is still missing", () => {
    expect(firstRunNotice({ status: "idle" }, "granted", false)?.text).toMatch(/^The first Stop downloads the speech model/);
    expect(firstRunNotice({ status: "idle" }, "prompt", true)?.title).toBe("Microphone needed");
    expect(firstRunNotice({ status: "idle" }, "denied", true)?.text).toMatch(/blocked/);
    expect(firstRunNotice({ status: "idle" }, "granted", true)).toBeNull();
    // Not known yet, or not queryable: nothing to claim.
    expect(firstRunNotice({ status: "idle" }, undefined, undefined)).toBeNull();
  });

  it("is shown only while idle", () => {
    expect(firstRunNotice({ status: "recording", t0: 1 }, "granted", false)).toBeNull();
    // The error says what to do about the same step; the notice would only push it down.
    expect(firstRunNotice({ status: "idle", error: "Could not download the speech model: check your internet connection." }, "granted", false)).toBeNull();
  });
});

describe("recordingTimeMs (the popup's Time)", () => {
  const t0 = 100_000;
  const processing = { startedAt: t0 + 12_400, audioMs: 12_400, estimatedEnd: t0 + 20_000, deadline: t0 + 900_000, firstRun: false };

  it("counts from t0 while recording", () => {
    expect(recordingTimeMs({ status: "recording", t0 }, t0 + 5_000)).toBe(5_000);
  });

  it("shows the recording's length while it is processed: wall-clock at Stop, then the decoded audio", () => {
    expect(recordingTimeMs({ status: "stopping", t0, processing: { ...processing, stage: "stopping" } }, t0 + 60_000)).toBe(12_400);
    const decoded = { ...processing, audioMs: 12_000, stage: "transcribing" } as const;
    expect(recordingTimeMs({ status: "processing", t0, processing: decoded }, t0 + 60_000)).toBe(12_000);
  });

  it("keeps showing the finished recording's length once processing ended, until the next one starts", () => {
    // The idle state keeps no t0 and no processing info: only lastResult.
    const lastResult = { sessionId: "s1", finishedAt: t0 + 20_000, copied: true, audioMs: 12_000, processingMs: 7_600 };
    const idle: RecorderState = { status: "idle", lastSessionId: "s1", lastResult };
    expect(formatElapsed(recordingTimeMs(idle, t0 + 3_600_000))).toBe("0:12");
    // Also when that processing failed. From Record on, it is the new recording's time.
    expect(recordingTimeMs({ status: "idle", lastResult, error: "Could not transcribe." }, 0)).toBe(12_000);
    expect(recordingTimeMs({ status: "starting", lastResult }, 0)).toBe(0);
    expect(recordingTimeMs({ status: "recording", t0: 500_000, lastResult }, 501_000)).toBe(1_000);
  });

  it("is zero before any recording", () => {
    expect(recordingTimeMs({ status: "idle" }, 123_456)).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("formats m:ss like every other duration in the popup, and hours when needed", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_999)).toBe("1:05");
    expect(formatElapsed(754_000)).toBe("12:34");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

describe("metaLine", () => {
  const info: ProcessingInfo = { startedAt: 0, audioMs: 12_600, stage: "transcribing", estimatedEnd: 1, deadline: 2, firstRun: false };

  it("sums the recording up in one line while it is processed and after", () => {
    expect(metaLine({ status: "processing", processing: info }, 2)).toBe("0:12 of audio · 2 events");
    const lastResult = { sessionId: "s1", finishedAt: 1, copied: true, audioMs: 6_000, processingMs: 1 };
    expect(metaLine({ status: "idle", lastResult }, 1)).toBe("0:06 of audio · 1 event");
  });

  it("uses the Time card's format, so one recording never shows two lengths", () => {
    expect(metaLine({ status: "processing", processing: info }, 0)?.split(" ")[0]).toBe(formatElapsed(12_600));
  });

  it("is absent while recording (the cards say it) and before any recording", () => {
    expect(metaLine({ status: "recording", t0: 1 }, 3)).toBeNull();
    expect(metaLine({ status: "idle" }, 0)).toBeNull();
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

  it("is grey under a result, where green would compete with the result's headline", () => {
    expect(tabCaptureView({ status: "attached" }, { status: "idle", lastSessionId: "s1" }).tone).toBe("muted");
    expect(tabCaptureView({ status: "attached" }, { status: "idle", error: "Boom" }).tone).toBe("muted");
  });

  it("explains where Pointcast runs, as an error while recording", () => {
    const view = tabCaptureView({ status: "not-local" }, idle);
    expect(view.text).toBe(
      "This tab is not captured: Pointcast runs on local dev hosts (localhost, *.localhost, 127.0.0.1, [::1], *.test) and on sites you enable, not on file:// pages.",
    );
    expect(view.tone).toBe("warning");
    expect(tabCaptureView({ status: "not-local" }, recording).tone).toBe("error");
    expect(tabCaptureView({ status: "not-local" }, { status: "starting" }).tone).toBe("error");
  });

  it("shows why a local tab could not be attached", () => {
    const capture = { status: "unavailable", error: "Frame with ID 0 is showing error page" } as const;
    expect(tabCaptureView(capture, recording)).toEqual({
      text: "This tab is not captured: Pointcast could not attach to it (Frame with ID 0 is showing error page). Reload the page.",
      tone: "error",
    });
    expect(tabCaptureView(capture, idle).tone).toBe("warning");
  });
});

describe("the last event, in words", () => {
  it("names the element by what it is, not by its HTML tag", () => {
    expect(friendlyEvent("a «View report» · Alt+click")).toBe("link “View report”");
    expect(friendlyEvent("button «Export» · Alt+click")).toBe("button “Export”");
    expect(friendlyEvent("input «Password» · Alt+click")).toBe("field “Password”");
    expect(friendlyEvent("th «Quantity» · Alt+click")).toBe("column header “Quantity”");
  });

  it("leaves out a tag with no word for it, and names the gesture only when it is not Alt+click", () => {
    expect(friendlyEvent("span «3» · Alt+click")).toBe("“3”");
    expect(friendlyEvent("my-widget «Total» · click")).toBe("“Total” · click");
    expect(friendlyEvent("p «some words» · selection")).toBe("paragraph “some words” · selection");
    expect(friendlyEvent("div · Alt+click")).toBe("element");
    expect(friendlyEvent("img · Alt+click")).toBe("image");
  });

  it("does not trip on names with the separators in them, nor on tag names like constructor", () => {
    expect(friendlyEvent("button «a · b» · Alt+click")).toBe("button “a · b”");
    expect(friendlyEvent("constructor «x» · Alt+click")).toBe("“x”");
  });

  it("shows a summary in another shape as it is", () => {
    expect(friendlyEvent("something else")).toBe("something else");
  });

  it("is shown while recording, as Last:, and after Undo, as Undone:", () => {
    expect(lastEventText({ status: "recording", t0: 1 }, "a «View report» · Alt+click")).toBe("Last: link “View report”");
    expect(undoneText("th «Quantity» · Alt+click")).toBe("Undone: column header “Quantity”");
  });

  it("shows nothing before the first event, or when not recording", () => {
    expect(lastEventText({ status: "recording", t0: 1 }, undefined)).toBeNull();
    for (const status of ["idle", "starting", "stopping"] as const) {
      expect(lastEventText({ status }, "button «Export» · Alt+click")).toBeNull();
    }
  });
});

describe("shortcutHint", () => {
  it("names both bindings as Chrome reports them: localized, per platform, or as the user changed them", () => {
    expect(shortcutHint("Alt+Shift+S", "Alt+Shift+U")).toEqual([
      { key: "Alt+Shift+S" },
      { text: " record" },
      { text: " · " },
      { key: "Alt+Shift+U" },
      { text: " undo" },
    ]);
    expect(shortcutHint("⌥⇧S", "")).toEqual([{ key: "⌥⇧S" }, { text: " record" }]);
  });

  it("says where to set one when Record/Stop has no binding", () => {
    expect(shortcutHint("", "Alt+Shift+U")).toEqual([
      { text: "No keyboard shortcut for Record/Stop: set one in chrome://extensions/shortcuts." },
    ]);
  });

  it("hides the line when the command is unknown", () => {
    expect(shortcutHint(undefined, "Alt+Shift+U")).toBeNull();
  });
});

describe("processingPanel", () => {
  const info = { startedAt: 1_000, audioMs: 12_000, estimatedEnd: 11_000, deadline: 999_999, firstRun: false } as const;

  it("shows the estimate while stopping and processing, and nothing otherwise", () => {
    const panel = processingPanel({ status: "processing", processing: { ...info, stage: "transcribing" } }, 6_000);
    expect(panel).toMatchObject({ text: "Processing… ~0:05", fraction: 0.5, stage: "Processing…" });
    expect(panel?.detail).toBe("The time is estimated from earlier runs on this device.");
    expect(processingPanel({ status: "idle" }, 6_000)).toBeNull();
  });

  it("says Preparing, with no estimate, on the first run until the download reports", () => {
    const panel = processingPanel({ status: "stopping", processing: { ...info, firstRun: true, stage: "stopping" } }, 6_000);
    expect(panel).toMatchObject({ text: "Preparing…", fraction: null, stage: "Preparing…" });
    expect(panel?.detail).not.toMatch(/\d/);
  });

  it("shows the download in MB from the report, and no other size", () => {
    const downloading = { ...info, firstRun: true, stage: "downloading-model", loadedBytes: 100e6, totalBytes: 294e6 } as const;
    const panel = processingPanel({ status: "processing", processing: downloading }, 6_000);
    expect(panel?.text).toMatch(/100 \/ 294 MB$/);
    expect(panel?.stage).toBe("Downloading the speech model…");
    expect(panel?.detail).not.toMatch(/\d/);
    const unknown = processingPanel({ status: "processing", processing: { ...downloading, loadedBytes: 0, totalBytes: 0 } }, 6_000);
    expect(unknown?.fraction).toBeNull();
  });
});

describe("resultView", () => {
  const lastResult = { sessionId: "s1", finishedAt: 1, copied: true, downloadId: 7, audioMs: 12_000, processingMs: 6_400 };

  it("offers Copy again and Show in folder after a good run, and says where it is on one line", () => {
    expect(resultView({ status: "idle", lastSessionId: "s1", lastResult }, true)).toEqual({
      where: { label: "Saved to Downloads › pointcast", path: "s1", title: "Downloads/pointcast/s1/" },
      warning: null,
      code: null,
      copyAgain: true,
      showInFolder: 7,
    });
  });

  it("adds one line on how the code pointers resolved against the dev server, success or not", () => {
    const code = "Code pointer: dev server source not available (not a Vite dev server).";
    expect(resultView({ status: "idle", lastSessionId: "s1", lastResult: { ...lastResult, code } }, true)?.code).toBe(code);
  });

  it("splits a warning into what happened and the rest", () => {
    const warning = "Not sent to the MCP server. It refused this recording: disk full.";
    expect(resultView({ status: "idle", lastSessionId: "s1", lastResult, warning }, true)?.warning).toEqual({
      lead: "Not sent to the MCP server.",
      body: "It refused this recording: disk full.",
    });
  });

  it("does not offer to copy a failed session's (or a missing) Markdown, nor claim where it was saved", () => {
    const failed = resultView({ status: "idle", lastResult, error: "Could not transcribe." }, true);
    expect(failed).toMatchObject({ copyAgain: false, where: null, showInFolder: 7 });
    expect(resultView({ status: "idle", lastResult }, false)?.copyAgain).toBe(false);
    expect(resultView({ status: "recording", t0: 1, lastResult }, true)).toBeNull();
    expect(resultView({ status: "idle" }, true)).toBeNull();
  });

  describe("a session a Pointcast MCP server stored (D11)", () => {
    const dir = "~\\AppData\\Local\\Temp\\x\\mcp-sessions\\s1";
    const handedOff: RecorderState = {
      status: "idle",
      lastSessionId: "s1",
      lastResult: { sessionId: "s1", finishedAt: 1, copied: true, handedOffTo: dir, audioMs: 12_000, processingMs: 5_000 },
    };

    it("has Copy path instead of Show in folder: Chrome downloaded nothing it could reveal", () => {
      expect(resultView(handedOff, true)).toEqual({
        where: { label: "Sent to your agent's Pointcast MCP server", path: "…\\mcp-sessions\\s1", title: dir },
        warning: null,
        code: null,
        copyAgain: true,
        copyPath: dir,
      });
    });
  });
});

describe("shortPath", () => {
  it("keeps the end of a long path, where the session id is", () => {
    expect(shortPath("~\\AppData\\Local\\Temp\\mcp-sessions\\2026-09-28_11-38-25")).toBe("…\\mcp-sessions\\2026-09-28_11-38-25");
    expect(shortPath("~/Downloads/pointcast/s1")).toBe("…/pointcast/s1");
  });

  it("leaves a short path whole", () => {
    expect(shortPath("~/pointcast/s1")).toBe("~/pointcast/s1");
  });
});

describe("splitLead", () => {
  it("cuts after the first sentence", () => {
    expect(splitLead("One. Two three.")).toEqual({ lead: "One.", body: "Two three." });
    expect(splitLead("No period")).toEqual({ lead: "No period", body: "" });
    // A dot inside a word (a file name) does not end the sentence.
    expect(splitLead("Audio kept as audio.webm. Convert it.")).toEqual({ lead: "Audio kept as audio.webm.", body: "Convert it." });
    // "What happened: what to do": the lead ends at the colon, as in the mockups.
    expect(splitLead("Not sent to the Pointcast MCP server: it refused this recording (disk full). Paste it instead.")).toEqual({
      lead: "Not sent to the Pointcast MCP server.",
      body: "It refused this recording (disk full). Paste it instead.",
    });
    expect(splitLead("Could not download the speech model: check your connection. Saved.").lead).toBe("Could not download the speech model.");
    // A colon after the first sentence, or in a time, does not split.
    expect(splitLead("Saved. Note: later.")).toEqual({ lead: "Saved.", body: "Note: later." });
    expect(splitLead("Stopped at 1:05 into it. Record again.").lead).toBe("Stopped at 1:05 into it.");
  });
});

describe("site section", () => {
  it("makes Enable the primary step on a remote site, says Chrome will ask, and that personal data is redacted", () => {
    const view = siteView({ host: "example.com", enabled: false });
    expect(view?.button).toBe("Enable on example.com");
    expect(view?.kind).toBe("primary");
    expect(view?.note).toContain("this site only");
    expect(view?.note).toContain("redacted");
    expect(tabCaptureView({ status: "not-local" }, { status: "idle" }, "example.com").text).toBe("Pointcast is off on example.com.");
  });

  it("leaves the one violet button to Allow microphone until Chrome has the grant", () => {
    expect(siteView({ host: "example.com", enabled: false }, "prompt")?.kind).toBe("secondary");
    expect(siteView({ host: "example.com", enabled: false }, "denied")?.kind).toBe("secondary");
    expect(siteView({ host: "example.com", enabled: false }, "granted")?.kind).toBe("primary");
  });

  it("offers to remove an enabled site, and is hidden elsewhere", () => {
    const view = siteView({ host: "example.com", enabled: true });
    expect(view?.button).toBe("Remove example.com");
    expect(view?.kind).toBe("secondary");
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
});

describe("stageAnnouncement (screen readers)", () => {
  const info = { startedAt: 1_000, audioMs: 12_000, estimatedEnd: 11_000, deadline: 999_999, firstRun: false } as const;

  it("names the stage without the countdown, so it does not change every second", () => {
    const state: RecorderState = { status: "processing", processing: { ...info, stage: "transcribing" } };
    expect(stageAnnouncement(state, 2_000)).toBe("Processing…");
    expect(stageAnnouncement(state, 9_000)).toBe("Processing…");
    expect(stageAnnouncement({ status: "processing", processing: { ...info, stage: "saving" } }, 2_000)).toBe("Saving…");
  });

  it("names the recorder's status otherwise, and nothing when idle", () => {
    expect(stageAnnouncement({ status: "recording", t0: 1 }, 2_000)).toBe("Recording");
    expect(stageAnnouncement({ status: "idle" }, 2_000)).toBe("");
  });
});

describe("typed mode (D12)", () => {
  it("offers Record without the microphone grant or the model notice", () => {
    for (const microphone of ["prompt", "denied"] as const) {
      expect(popupView({ status: "idle" }, { microphone, inputMode: "typed" }).button).toMatchObject({
        text: "Record",
        action: "start",
      });
      expect(siteView({ host: "example.com", enabled: false }, undefined)?.kind).toBe("primary");
    }
    expect(firstRunNotice({ status: "idle" }, "prompt", false, "typed")).toBeNull();
    expect(firstRunNotice({ status: "idle" }, "prompt", false)).not.toBeNull();
  });

  it("shows the Voice / Typed choice where the user records, fixed while recording", () => {
    expect(modeView({ status: "idle" }, "typed")).toEqual({ visible: true, enabled: true, value: "typed" });
    // A recording keeps the mode it started with, whatever the setting says now.
    expect(modeView({ status: "recording", t0: 1, inputMode: "typed" }, "voice")).toEqual({
      visible: true,
      enabled: false,
      value: "typed",
    });
    expect(modeView({ status: "recording", t0: 1 }, "typed").value).toBe("voice");
    expect(modeView({ status: "processing" }, "typed").visible).toBe(false);
    expect(pointingHint("typed")).toBe("Alt+click or select text, then type what should change.");
    expect(pointingHint("voice")).toBe("Alt+click or select text to point.");
    // Chrome maps Alt to Option on macOS: the popup names the key a Mac keyboard shows.
    expect(pointingHint("voice", true)).toBe("⌥ Option+click or select text to point.");
    expect(pointingHint("typed", true)).toBe("⌥ Option+click or select text, then type what should change.");
  });

  it("says how long the notes took, not how much audio there is", () => {
    const processing: ProcessingInfo = {
      startedAt: 1,
      audioMs: 12_000,
      stage: "saving",
      estimatedEnd: 2,
      deadline: 3,
      firstRun: false,
    };
    expect(metaLine({ status: "processing", inputMode: "typed", processing }, 2)).toBe("0:12 of notes · 2 events");
    const lastResult = { sessionId: "s", finishedAt: 1, copied: true, audioMs: 5_000, processingMs: 1, typed: true };
    expect(metaLine({ status: "idle", lastSessionId: "s", lastResult }, 1)).toBe("0:05 of notes · 1 event");
    expect(processingPanel({ status: "processing", inputMode: "typed", processing: { ...processing, stage: "stopping" } }, 1)?.detail).toBe("");
  });
});
