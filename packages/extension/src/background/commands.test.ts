import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, ProcessingResult, RecorderStopResult } from "../messages";
import type { RecorderState } from "../recorder-state";
import { formatSessionId } from "../session-id";

/** In-memory stand-ins for the Chrome APIs the service worker uses. */
const fake = vi.hoisted(() => {
  const area = (map: Map<string, unknown>) => ({
    get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value);
    },
  });
  const storage = new Map<string, unknown>();
  const local = new Map<string, unknown>();
  const downloads = new Map<number, { id: number; filename: string; state: string; error?: string }>();
  return {
    storage,
    local,
    area,
    downloads,
    alarms: new Map<string, number>(),
    offscreenOpen: false,
    sendMessage: vi.fn<(message: Message) => Promise<unknown>>(),
    notify: vi.fn(async (_title: string, _message: string) => undefined),
    outcomeBadge: vi.fn(async (_ok: boolean) => undefined),
    /** Resolves the pending attachToOpenTabs() call. */
    finishAttaching: undefined as (() => void) | undefined,
    attachToOpenTabs: vi.fn<() => Promise<unknown[]>>(),
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    storage: { session: fake.area(fake.storage), local: fake.area(fake.local) },
    runtime: { getManifest: () => ({ version: "0.1.0" }), getURL: (path: string) => path },
    tabs: { create: vi.fn() },
    alarms: {
      create: async (name: string, { when }: { when: number }) => void fake.alarms.set(name, when),
      clear: async (name: string) => fake.alarms.delete(name),
    },
    downloads: {
      download: async ({ filename }: { filename: string }) => {
        const id = fake.downloads.size + 1;
        fake.downloads.set(id, { id, filename: `C:\\Users\\me\\Downloads\\${filename.replace(/\//g, "\\")}`, state: "complete" });
        return id;
      },
      search: async (query: { id?: number; filenameRegex?: string }) => {
        const items = [...fake.downloads.values()];
        if (query.id !== undefined) return items.filter((item) => item.id === query.id);
        const pattern = new RegExp(query.filenameRegex ?? "");
        return items.filter((item) => pattern.test(item.filename));
      },
    },
  },
}));
/** The extension origin's Cache API, where the last Markdown is kept (state-store.ts). */
const markdownCache = new Map<string, string>();
vi.stubGlobal("caches", {
  open: async () => ({
    match: async (url: string) => (markdownCache.has(url) ? new Response(markdownCache.get(url)) : undefined),
    put: async (url: string, response: Response) => void markdownCache.set(url, await response.text()),
  }),
  delete: async () => markdownCache.clear(),
});
vi.mock("../messages", () => ({ sendMessage: (message: Message) => fake.sendMessage(message) }));
vi.mock("./badge", () => ({ showBadge: async () => undefined, showOutcomeBadge: fake.outcomeBadge }));
vi.mock("./notify", () => ({ notify: fake.notify }));
vi.mock("./content-scripts", () => ({ attachToOpenTabs: () => fake.attachToOpenTabs() }));
vi.mock("./offscreen-document", () => ({
  hasOffscreenDocument: async () => fake.offscreenOpen,
  ensureOffscreenDocument: async () => {
    fake.offscreenOpen = true;
  },
  closeOffscreenDocument: async () => {
    fake.offscreenOpen = false;
  },
}));

const commands = await import("./commands");
const { browser } = await import("wxt/browser");
const { readLastMarkdown } = await import("../state-store");

const T0 = new Date(2026, 8, 26, 18, 30, 5, 500).getTime();
const BASE_ID = formatSessionId(new Date(T0));

const state = (): RecorderState => fake.storage.get("recorder") as RecorderState;

function recorderStops(durationMs = 12_000, pendingMs = durationMs, modelLoaded = false): void {
  fake.sendMessage.mockImplementation(async (message) => {
    if (message.type !== "recorder-stop") return undefined;
    return { ok: true, sessionId: message.sessionId, durationMs, pendingMs, modelLoaded, eventCount: 2 } satisfies RecorderStopResult;
  });
}

function stopMessage() {
  const message = fake.sendMessage.mock.calls.map(([m]) => m).find((m) => m.type === "recorder-stop");
  if (message?.type !== "recorder-stop") throw new Error("no recorder-stop was sent");
  return message;
}

/** Records, then stops: the state is "processing" afterwards. */
async function stopped(): Promise<void> {
  fake.storage.set("recorder", { status: "recording", t0: T0 });
  fake.offscreenOpen = true;
  recorderStops();
  expect(await commands.stopRecording()).toEqual({ ok: true });
}

const DONE: ProcessingResult = {
  files: [
    { url: "blob:md", fileName: "session.md" },
    { url: "blob:words", fileName: "words.json" },
    { url: "blob:session", fileName: "session.json" },
  ],
  markdown: "This *[00:04 · th «Quantity» · e1]* …",
  copied: true,
  language: "es",
  audioMs: 12_000,
  timings: { loadMs: 1_500, transcribeMs: 3_000, audioMs: 12_000 },
  code: "Code pointer: 1 location found in the source the dev server serves.",
};

beforeEach(() => {
  fake.storage.clear();
  fake.local.clear();
  markdownCache.clear();
  fake.downloads.clear();
  fake.alarms.clear();
  fake.offscreenOpen = false;
  fake.sendMessage.mockReset();
  fake.notify.mockClear();
  fake.outcomeBadge.mockClear();
  fake.attachToOpenTabs.mockReset();
  fake.attachToOpenTabs.mockResolvedValue([]);
  vi.mocked(browser.tabs.create).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("stopRecording", () => {
  it("goes to processing once the recorder has decoded the audio, with the popup's settings", async () => {
    fake.local.set("settings", { language: "es", keepAudio: true, notify: true });
    await stopped();

    expect(stopMessage()).toMatchObject({
      sessionId: BASE_ID,
      options: { language: "es", keepAudio: true, deadline: expect.any(Number) },
    });
    expect(state()).toMatchObject({
      status: "processing",
      sessionId: BASE_ID,
      // First run: the model download is shown in MB rather than as a time.
      processing: { audioMs: 12_000, stage: "downloading-model", firstRun: true },
    });
    expect(fake.storage.get("eventCount")).toBe(2);
    // The safety net for an offscreen document that never reports back.
    expect(fake.alarms.get(commands.PROCESSING_ALARM)).toBeGreaterThan(stopMessage().options.deadline);
    expect(fake.offscreenOpen).toBe(true);
  });

  it("detects the language by default, with the last session's language as the fallback", async () => {
    fake.local.set("processingStats", { speed: { loadMs: 1000, msPerAudioSecond: 200 }, modelReady: true, lastLanguage: "en" });
    await stopped();

    expect(stopMessage().options).toEqual({ fallbackLanguage: "en", keepAudio: false, deadline: expect.any(Number) });
    // The estimate comes from this device's speed: 1 s fixed + 1 s load + 0.5 s + 200 ms × 12 s.
    const { processing } = state();
    expect(processing?.stage).toBe("transcribing");
    expect((processing?.estimatedEnd ?? 0) - (processing?.startedAt ?? 0)).toBe(1_000 + 1_000 + 500 + 2_400);
  });

  it("estimates only the audio that live transcription has not done yet", async () => {
    fake.local.set("processingStats", { speed: { loadMs: 1000, msPerAudioSecond: 200 }, modelReady: true });
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.offscreenOpen = true;
    recorderStops(150_000, 10_000);
    expect(await commands.stopRecording()).toEqual({ ok: true });

    const { processing } = state();
    // The popup still says how long the recording is; the wait is for the last 10 s only.
    expect(processing?.audioMs).toBe(150_000);
    expect((processing?.estimatedEnd ?? 0) - (processing?.startedAt ?? 0)).toBe(1_000 + 1_000 + 500 + 2_000);
  });

  it("on a first run, skips the download stage when live transcription already loaded the model", async () => {
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.offscreenOpen = true;
    recorderStops(150_000, 10_000, true);
    expect(await commands.stopRecording()).toEqual({ ok: true });

    const { processing } = state();
    expect(processing).toMatchObject({ stage: "transcribing", firstRun: true });
    expect(processing?.estimatedEnd).toBeGreaterThan(processing?.startedAt ?? Infinity);
  });

  it("leaves out the model load from the estimate once live transcription loaded it", async () => {
    fake.local.set("processingStats", { speed: { loadMs: 1000, msPerAudioSecond: 200 }, modelReady: true });
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.offscreenOpen = true;
    recorderStops(150_000, 10_000, true);
    await commands.stopRecording();
    const { processing } = state();
    expect((processing?.estimatedEnd ?? 0) - (processing?.startedAt ?? 0)).toBe(1_000 + 500 + 2_000);
  });

  it("picks a new folder when a session in the same second already used the id", async () => {
    fake.downloads.set(99, { id: 99, filename: `C:\\Users\\me\\Downloads\\pointcast\\${BASE_ID}\\audio.wav`, state: "complete" });
    await stopped();
    expect(stopMessage().sessionId).toBe(`${BASE_ID}-2`);
    expect(state().sessionId).toBe(`${BASE_ID}-2`);
  });

  it("does not stay in 'stopping' when the recorder never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.offscreenOpen = true;
    fake.sendMessage.mockImplementation(() => new Promise(() => undefined));

    const result = commands.stopRecording();
    await vi.advanceTimersByTimeAsync(commands.STOP_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, error: "The recorder did not finish saving in time." });
    expect(state()).toMatchObject({ status: "idle", error: "The recorder did not finish saving in time." });
    expect(fake.offscreenOpen).toBe(false);
    expect(fake.alarms.size).toBe(0);
    expect(fake.outcomeBadge).toHaveBeenCalledWith(false);
  });
});

describe("recordProcessingProgress", () => {
  it("shows the first model download in MB, then estimates the time left once it is loaded", async () => {
    await stopped();
    await commands.recordProcessingProgress(BASE_ID, { stage: "loading-model", model: "m", loadedBytes: 50e6, totalBytes: 291e6 });
    expect(state().processing).toMatchObject({ stage: "downloading-model", loadedBytes: 50e6, totalBytes: 291e6 });

    const before = Date.now();
    await commands.recordProcessingProgress(BASE_ID, { stage: "model-ready", model: "m" });
    const { processing } = state();
    expect(processing?.stage).toBe("transcribing");
    // Default speed (300 ms per audio second) for 12 s, plus half the fixed time.
    expect(processing?.estimatedEnd).toBeGreaterThanOrEqual(before + 500 + 3_600);
  });

  it("ignores reports for another session", async () => {
    await stopped();
    const before = state();
    await commands.recordProcessingProgress("other", { stage: "model-ready", model: "m" });
    expect(state()).toEqual(before);
  });
});

describe("finishProcessing", () => {
  it("saves every file, keeps the Markdown for Copy again, learns the speed, and says it is done", async () => {
    await stopped();
    expect(await commands.finishProcessing(BASE_ID, DONE)).toEqual({ ok: true });

    expect([...fake.downloads.values()].map((d) => d.filename)).toEqual(
      ["session.md", "words.json", "session.json"].map((f) => `C:\\Users\\me\\Downloads\\pointcast\\${BASE_ID}\\${f}`),
    );
    expect(state()).toMatchObject({
      status: "idle",
      lastSessionId: BASE_ID,
      lastResult: { sessionId: BASE_ID, copied: true, downloadId: 1, audioMs: 12_000, code: DONE.code },
    });
    expect(state().error).toBeUndefined();
    // Saved right where startSessionDownloads asked Chrome to put it: no warning.
    expect(state().warning).toBeUndefined();
    expect(await readLastMarkdown()).toBe(DONE.markdown);
    // Never where content scripts can read it: that area is open to them (background.ts).
    expect([...fake.storage.values()]).not.toContain(DONE.markdown);
    // First run: the load time included the download, so only the transcription speed is learned.
    expect(fake.local.get("processingStats")).toEqual({
      speed: { loadMs: 2_000, msPerAudioSecond: 275 },
      modelReady: true,
      lastLanguage: "es",
    });
    expect(fake.offscreenOpen).toBe(false);
    expect(fake.alarms.size).toBe(0);
    expect(fake.outcomeBadge).toHaveBeenCalledWith(true);
    expect(fake.notify).toHaveBeenCalledWith("pointcast", expect.stringMatching(/^Copied — paste it into your agent\. Saved to/));
  });

  it("keeps a transcription error with the saved session, and notifies it", async () => {
    await stopped();
    await commands.finishProcessing(BASE_ID, {
      files: [
        { url: "blob:session", fileName: "session.json" },
        { url: "blob:audio", fileName: "audio.wav" },
      ],
      copied: false,
      audioMs: 12_000,
      error: "Could not transcribe: offline.",
    });
    expect(state()).toMatchObject({ status: "idle", lastSessionId: BASE_ID, error: "Could not transcribe: offline." });
    expect(await readLastMarkdown()).toBeUndefined();
    expect(fake.outcomeBadge).toHaveBeenCalledWith(false);
    expect(fake.notify).toHaveBeenCalledWith("pointcast: could not transcribe", "Could not transcribe: offline.");
  });

  it("ends in an error when nothing could be saved", async () => {
    await stopped();
    await commands.finishProcessing(BASE_ID, { files: [], copied: false, audioMs: 0, error: "Processing failed unexpectedly: bug" });
    expect(state()).toMatchObject({ status: "idle", error: "Processing failed unexpectedly: bug" });
    expect(state().lastSessionId).toBeUndefined();
    expect(fake.offscreenOpen).toBe(false);
  });

  it("is idempotent: a repeated or stale report saves nothing twice", async () => {
    await stopped();
    await commands.finishProcessing(BASE_ID, DONE);
    await commands.finishProcessing(BASE_ID, DONE);
    await commands.finishProcessing("another-session", DONE);
    expect(fake.downloads.size).toBe(3);
  });

  it("ends in an error when a download cannot start, so a retried report saves nothing twice", async () => {
    await stopped();
    const download = browser.downloads.download;
    browser.downloads.download = async (options) => {
      if (options.filename?.endsWith("words.json")) throw new Error("Invalid filename");
      return download(options);
    };
    try {
      expect(await commands.finishProcessing(BASE_ID, DONE)).toEqual({ ok: true });
      expect(await commands.finishProcessing(BASE_ID, DONE)).toEqual({ ok: true });
    } finally {
      browser.downloads.download = download;
    }
    expect(fake.downloads.size).toBe(2);
    expect(state()).toMatchObject({ status: "idle", error: `Saving session ${BASE_ID} failed: Invalid filename` });
    expect(fake.offscreenOpen).toBe(false);
    expect(fake.alarms.size).toBe(0);
    expect(fake.notify).toHaveBeenCalledWith("pointcast: saving failed", expect.stringContaining("Invalid filename"));
  });

  it("does not notify when the user turned notifications off", async () => {
    fake.local.set("settings", { language: "auto", keepAudio: false, notify: false });
    await stopped();
    await commands.finishProcessing(BASE_ID, DONE);
    expect(fake.notify).not.toHaveBeenCalled();
    expect(fake.outcomeBadge).toHaveBeenCalledWith(true);
  });

  it("keeps processing while downloads run, and finishes when they complete", async () => {
    await stopped();
    const download = browser.downloads.download;
    browser.downloads.download = async (options) => {
      const id = await download(options);
      const item = fake.downloads.get(id);
      if (item) item.state = "in_progress";
      return id;
    };
    try {
      await commands.finishProcessing(BASE_ID, DONE);
    } finally {
      browser.downloads.download = download;
    }
    expect(state()).toMatchObject({ status: "processing", processing: { stage: "saving" } });
    for (const item of fake.downloads.values()) item.state = "complete";
    await commands.finishSessionIfSaved();
    expect(state().status).toBe("idle");
  });

  it("warns when Chrome's 'ask where to save' setting saved a file outside the session folder", async () => {
    await stopped();
    const download = browser.downloads.download;
    // Chrome shows a Save dialog for every file when that setting is on, ignoring `saveAs: false`;
    // simulate the user pointing one of them at the plain Downloads folder instead.
    browser.downloads.download = async (options) => {
      const id = await download(options);
      const item = fake.downloads.get(id);
      if (item && options.filename?.endsWith("session.md")) item.filename = "C:\\Users\\me\\Downloads\\session.md";
      return id;
    };
    try {
      await commands.finishProcessing(BASE_ID, DONE);
    } finally {
      browser.downloads.download = download;
    }
    expect(state()).toMatchObject({
      status: "idle",
      warning: expect.stringMatching(/Chrome asked where to save each file.*not in Downloads\/pointcast/),
    });
    // Must not claim it saved to the session folder when it did not.
    expect(fake.notify).toHaveBeenCalledWith(
      "pointcast",
      "Copied — paste it into your agent. See the popup for a warning.",
    );
  });

  it("says a save dialog was cancelled, with the same advice, when a download is USER_CANCELED", async () => {
    await stopped();
    const download = browser.downloads.download;
    browser.downloads.download = async (options) => {
      const id = await download(options);
      if (options.filename?.endsWith("words.json")) {
        const item = fake.downloads.get(id);
        if (item) {
          item.state = "interrupted";
          item.error = "USER_CANCELED";
        }
      }
      return id;
    };
    try {
      expect(await commands.finishProcessing(BASE_ID, DONE)).toEqual({ ok: true });
    } finally {
      browser.downloads.download = download;
    }
    expect(state()).toMatchObject({
      status: "idle",
      error: expect.stringMatching(/a save dialog was cancelled.*Ask where to save each file before downloading/),
    });
    expect(fake.notify).toHaveBeenCalledWith("pointcast: saving failed", expect.stringMatching(/save dialog was cancelled/));
  });
});

describe("abandonOverdueProcessing (the timeout alarm)", () => {
  it("ends a processing nobody finished, and frees the offscreen document", async () => {
    await stopped();
    await commands.abandonOverdueProcessing();
    expect(state()).toMatchObject({ status: "idle", error: expect.stringMatching(/stopped responding/) });
    expect(fake.offscreenOpen).toBe(false);
    expect(fake.notify).toHaveBeenCalled();
  });

  it("leaves a finished session alone", async () => {
    fake.storage.set("recorder", { status: "idle", lastSessionId: BASE_ID });
    await commands.abandonOverdueProcessing();
    expect(state()).toEqual({ status: "idle", lastSessionId: BASE_ID });
  });
});

describe("startRecording", () => {
  it("tells the recorder the language chosen in the popup, for live transcription", async () => {
    fake.local.set("settings", { language: "es", keepAudio: false, notify: true });
    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });
    expect(await commands.startRecording()).toEqual({ ok: true });
    expect(fake.sendMessage).toHaveBeenCalledWith({ to: "offscreen", type: "recorder-start", language: "es" });
  });

  it("reports recording only after every local tab was attached", async () => {
    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });
    fake.attachToOpenTabs.mockImplementation(
      () => new Promise((resolve) => (fake.finishAttaching = () => resolve([{ status: "attached" }]))),
    );

    const result = commands.startRecording();
    await vi.waitFor(() => expect(fake.sendMessage).toHaveBeenCalledWith({ to: "offscreen", type: "recorder-start" }));
    // Attaching started with the recorder, not after it, and the recorder is already running.
    expect(fake.attachToOpenTabs).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state().status).toBe("starting");

    fake.finishAttaching?.();
    expect(await result).toEqual({ ok: true });
    expect(state()).toEqual({ status: "recording", t0: T0 });
  });

  it("records even when some tabs could not be attached", async () => {
    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });
    fake.attachToOpenTabs.mockResolvedValue([{ status: "unavailable", error: "Frame with ID 0 is showing error page" }]);

    expect(await commands.startRecording()).toEqual({ ok: true });
    expect(state().status).toBe("recording");
  });

  it("does not stay in 'starting' when the recorder never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fake.sendMessage.mockImplementation(() => new Promise(() => undefined));

    const result = commands.startRecording();
    await vi.advanceTimersByTimeAsync(commands.START_TIMEOUT_MS);
    expect(await result).toMatchObject({ ok: false });
    expect(state().status).toBe("idle");
  });

  it("starts with no events: the count and the previous recording's last event are cleared", async () => {
    fake.storage.set("eventCount", 7);
    fake.storage.set("lastEvent", "button «Export» · Alt+click");
    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });

    await commands.startRecording();
    expect(fake.storage.get("eventCount")).toBe(0);
    expect(fake.storage.get("lastEvent")).toBeNull();
  });

  it("is refused while the previous session is processed", async () => {
    await stopped();
    expect(await commands.startRecording()).toEqual({ ok: false, error: "Cannot start while processing." });
  });
});

describe("recordEventCount", () => {
  it("stores the count and the last event together while recording", async () => {
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    await commands.recordEventCount(3, "th «Quantity» · selection");
    expect(fake.storage.get("eventCount")).toBe(3);
    expect(fake.storage.get("lastEvent")).toBe("th «Quantity» · selection");
  });

  it("ignores a late report once the recording is being saved", async () => {
    fake.storage.set("recorder", { status: "stopping", t0: T0 });
    await commands.recordEventCount(3, "th «Quantity» · selection");
    expect(fake.storage.has("eventCount")).toBe(false);
    expect(fake.storage.has("lastEvent")).toBe(false);
  });
});

describe("undoLastEvent", () => {
  it("removes the last gesture: the popup's count and line follow, and the pages hear which one", async () => {
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.sendMessage.mockResolvedValue({
      undone: { id: "e2", summary: "th «Quantity» · selection", count: 1, lastEvent: "button «Export» · Alt+click" },
    });

    expect(await commands.undoLastEvent()).toEqual({ ok: true, undone: "th «Quantity» · selection" });
    expect(fake.sendMessage).toHaveBeenCalledWith({ to: "offscreen", type: "recorder-undo" });
    expect(fake.storage.get("eventCount")).toBe(1);
    expect(fake.storage.get("lastEvent")).toBe("button «Export» · Alt+click");
    expect(fake.storage.get("undone")).toMatchObject({ id: "e2", summary: "th «Quantity» · selection" });
    expect(state()).toEqual({ status: "recording", t0: T0 });
  });

  it("says so when there is nothing to undo, and never asks the recorder outside a recording", async () => {
    fake.storage.set("recorder", { status: "recording", t0: T0 });
    fake.sendMessage.mockResolvedValue({ undone: null });
    expect(await commands.undoLastEvent()).toEqual({ ok: false, error: "Nothing to undo." });
    expect(fake.storage.has("undone")).toBe(false);

    fake.sendMessage.mockClear();
    fake.storage.set("recorder", { status: "idle" });
    expect(await commands.undoLastEvent()).toEqual({ ok: false, error: "Undo works while recording." });
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });
});

describe("toggleRecording (keyboard shortcut)", () => {
  it("starts when idle and stops while recording, like the popup's button", async () => {
    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });
    expect(await commands.toggleRecording()).toEqual({ ok: true });
    expect(state()).toEqual({ status: "recording", t0: T0 });

    recorderStops();
    expect(await commands.toggleRecording()).toEqual({ ok: true });
    expect(state().status).toBe("processing");
    expect(fake.sendMessage.mock.calls.map(([message]) => message.type)).toEqual(["recorder-start", "recorder-stop"]);
  });

  it("opens the permission page when the microphone is denied, like the popup's Record", async () => {
    fake.sendMessage.mockResolvedValue({ ok: false, reason: "microphone-denied", error: "Permission denied" });

    expect(await commands.toggleRecording()).toEqual({ ok: false, error: "Permission denied" });
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: "/permission.html" });
    expect(state()).toEqual({ status: "idle", error: "Permission denied" });
  });

  it("changes nothing while starting, stopping or processing", async () => {
    const busyStates = [
      { status: "starting" },
      { status: "stopping", t0: T0, sessionId: BASE_ID },
      { status: "processing", t0: T0, sessionId: BASE_ID },
    ] as RecorderState[];
    for (const busy of busyStates) {
      fake.storage.set("recorder", busy);
      expect(await commands.toggleRecording()).toEqual({ ok: false, error: `Cannot start while ${busy.status}.` });
      expect(state()).toEqual(busy);
    }
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });
});

describe("recoverInterruptedTransition (service worker restarted mid-transition)", () => {
  const processing = { startedAt: T0 + 12_000, audioMs: 12_000, estimatedEnd: T0 + 20_000, deadline: T0 + 900_000, firstRun: false };

  it("turns a stale 'starting' into idle, closes the offscreen document, and allows Record again", async () => {
    fake.storage.set("recorder", { status: "starting" });
    fake.offscreenOpen = true;

    await commands.recoverInterruptedTransition();
    expect(state()).toMatchObject({ status: "idle", error: expect.stringMatching(/Press Record again/) });
    expect(fake.offscreenOpen).toBe(false);

    fake.sendMessage.mockResolvedValue({ ok: true, t0: T0 });
    expect(await commands.startRecording()).toEqual({ ok: true });
  });

  it("resumes a stop whose answer was lost, with the stored session id and deadline", async () => {
    fake.storage.set("recorder", {
      status: "stopping",
      t0: T0,
      sessionId: `${BASE_ID}-3`,
      processing: { ...processing, stage: "stopping" },
    });
    fake.offscreenOpen = true;
    recorderStops();

    await commands.recoverInterruptedTransition();
    expect(stopMessage()).toMatchObject({ sessionId: `${BASE_ID}-3`, options: { deadline: processing.deadline } });
    expect(state()).toMatchObject({ status: "processing", sessionId: `${BASE_ID}-3` });
  });

  it("keeps waiting for a processing offscreen document, which reports when it is done", async () => {
    const busy = { status: "processing", t0: T0, sessionId: BASE_ID, processing: { ...processing, stage: "transcribing" } };
    fake.storage.set("recorder", busy);
    fake.offscreenOpen = true;

    await commands.recoverInterruptedTransition();
    expect(state()).toEqual(busy);
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it("gives up with an error when the offscreen document is gone", async () => {
    for (const status of ["stopping", "processing"] as const) {
      fake.storage.set("recorder", { status, t0: T0, sessionId: BASE_ID, processing: { ...processing, stage: "transcribing" } });
      await commands.recoverInterruptedTransition();
      expect(state()).toMatchObject({ status: "idle", error: expect.stringMatching(/lost/) });
    }
  });

  it("finishes a session whose downloads completed while the worker was stopped", async () => {
    fake.downloads.set(1, { id: 1, filename: "a", state: "complete" });
    fake.downloads.set(2, { id: 2, filename: "b", state: "complete" });
    fake.storage.set("recorder", {
      status: "processing",
      t0: T0,
      sessionId: BASE_ID,
      pendingDownloads: [1, 2],
      processing: { ...processing, stage: "saving" },
      pendingResult: { sessionId: BASE_ID, copied: true, downloadId: 1, audioMs: 12_000 },
    });

    await commands.recoverInterruptedTransition();
    expect(state()).toMatchObject({ status: "idle", lastSessionId: BASE_ID, lastResult: { copied: true, downloadId: 1 } });
  });

  it("leaves idle and recording states alone", async () => {
    for (const current of [{ status: "idle" }, { status: "recording", t0: T0 }] as RecorderState[]) {
      fake.storage.set("recorder", current);
      await commands.recoverInterruptedTransition();
      expect(state()).toEqual(current);
    }
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });
});
