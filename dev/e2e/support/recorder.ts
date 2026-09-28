import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import type { CapturedEventDraft, SessionFile, WordsFile } from "../../../packages/core/src/schema";
import type { E2eRecord } from "../../../packages/extension/src/e2e-record";
import type { CaptureEventResult, OffscreenMessage } from "../../../packages/extension/src/messages";
import type { Settings } from "../../../packages/extension/src/processing/settings";
import type { RecorderState, RecorderStatus } from "../../../packages/extension/src/recorder-state";
import { assertSessionFile } from "./session-schema";
import { readWav, type WavInfo } from "./wav-file";

/** Reads the recorder state exactly as the extension stores it (chrome.storage.session). */
export async function readRecorder(
  extensionPage: Page,
): Promise<{ state: RecorderState; eventCount: number; lastEvent: string | null }> {
  const stored = await extensionPage.evaluate(() => chrome.storage.session.get(["recorder", "eventCount", "lastEvent"]));
  return {
    state: (stored["recorder"] as RecorderState | undefined) ?? { status: "idle" },
    eventCount: (stored["eventCount"] as number | undefined) ?? 0,
    lastEvent: (stored["lastEvent"] as string | null | undefined) ?? null,
  };
}

export async function waitForStatus(extensionPage: Page, status: RecorderStatus, timeout = 15_000): Promise<RecorderState> {
  await expect.poll(async () => (await readRecorder(extensionPage)).state.status, { timeout }).toBe(status);
  return (await readRecorder(extensionPage)).state;
}

/** Changes the popup's settings (chrome.storage.local), e.g. to keep audio.wav for a test that reads it. */
export async function setSettings(extensionPage: Page, settings: Partial<Settings>): Promise<void> {
  const full: Settings = { language: "auto", keepAudio: false, notify: true, handoff: true, ...settings };
  await extensionPage.evaluate((value) => chrome.storage.local.set({ settings: value }), full);
}

/** What the e2e build recorded instead of touching the clipboard, notifications or a file manager. */
export async function readE2eRecords(extensionPage: Page): Promise<E2eRecord[]> {
  const stored = await extensionPage.evaluate(() => chrome.storage.session.get("e2eRecords"));
  return (stored["e2eRecords"] as E2eRecord[] | undefined) ?? [];
}

/**
 * Stop -> Markdown: transcription, fusion and saving take seconds, plus the model load in a fresh
 * profile. Generous, because the machine may be busy with other work.
 */
export const PROCESSING_TIMEOUT_MS = 90_000;

/** Presses the popup button (extensionPage is popup.html) and waits until recording. Returns t0. */
export async function startFromPopup(popup: Page): Promise<number> {
  await popup.bringToFront();
  await expect(popup.locator("#toggle")).toHaveText("Record");
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "recording");
  if (state.t0 === undefined) throw new Error("recording without t0");
  await expect(popup.locator("#status")).toHaveText("Recording");
  return state.t0;
}

/**
 * Presses Stop and waits until the session is processed and saved. Returns the wall-clock stop
 * time, the session id and the final state (lastResult says whether the Markdown was copied).
 */
export async function stopFromPopup(popup: Page): Promise<{ stoppedAt: number; sessionId: string; state: RecorderState }> {
  // A background tab gets no animation frames, and Playwright's click waits for frames to
  // check the button is stable: the click would land seconds after `stoppedAt`.
  await popup.bringToFront();
  await expect(popup.locator("#toggle")).toHaveText("Stop");
  const stoppedAt = Date.now();
  await popup.locator("#toggle").click();
  const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  expect(state.error).toBeUndefined();
  if (!state.lastSessionId) throw new Error("stopped without a saved session");
  // The folder is on its own line, the session id in the code font and the whole path in its title.
  await expect(popup.locator("#where-path")).toHaveAttribute("title", `Downloads/pointcast/${state.lastSessionId}/`);
  return { stoppedAt, sessionId: state.lastSessionId, state };
}

export interface SavedSession {
  folder: string;
  session: SessionFile;
  /** Present only when the audio was kept (setSettings keepAudio, or a language fallback). */
  wav?: WavInfo;
  words: WordsFile;
  markdown: string;
}

/**
 * Finds the session's files through chrome.downloads (the only record of where Chrome put them),
 * checks they are inside `downloadsDir`, and parses them.
 */
export async function readSavedSession(extensionPage: Page, downloadsDir: string, sessionId: string): Promise<SavedSession> {
  const items = await extensionPage.evaluate(() => chrome.downloads.search({}));
  const folder = path.join(downloadsDir, "pointcast", sessionId);
  const fileFor = (name: string) => {
    const item = items.find((i) => path.resolve(i.filename) === path.join(folder, name));
    if (!item) throw new Error(`${name} not found in ${folder}; downloads: ${items.map((i) => i.filename).join(", ")}`);
    expect(item.state).toBe("complete");
    return item.filename;
  };
  const session: unknown = JSON.parse(readFileSync(fileFor("session.json"), "utf8"));
  assertSessionFile(session);
  const words = JSON.parse(readFileSync(fileFor("words.json"), "utf8")) as WordsFile;
  const markdown = readFileSync(fileFor("session.md"), "utf8");
  // The audio is described in session.json exactly when it was saved (v2).
  expect(existsSync(path.join(folder, "audio.wav"))).toBe(session.audio !== undefined);
  const wav = session.audio ? readWav(readFileSync(fileFor("audio.wav"))) : undefined;
  return { folder, session, words, markdown, ...(wav ? { wav } : {}) };
}

/** The saved audio, for tests that turned "Keep audio" on. */
export function savedWav(saved: SavedSession): WavInfo {
  if (!saved.wav) throw new Error("audio.wav was not saved: turn keepAudio on with setSettings()");
  return saved.wav;
}

/**
 * Evaluates `expression` inside the pointcast content script's isolated world of `page`.
 * Playwright's page.evaluate only reaches the page's main world, so this goes through CDP:
 * the content script world is an execution context whose origin is the extension's.
 * After an extension reload a page has two such worlds (the orphaned copy's and the new one's),
 * and this picks the first: use it before reloading only (see extension-reload.spec.ts).
 */
export async function evaluateInContentScript<T>(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  expression: string,
): Promise<T> {
  const cdp = await context.newCDPSession(page);
  try {
    const contexts: { id: number; origin: string }[] = [];
    cdp.on("Runtime.executionContextCreated", ({ context: c }) => contexts.push({ id: c.id, origin: c.origin }));
    // Enabling Runtime replays executionContextCreated for every existing context.
    await cdp.send("Runtime.enable");
    const world = contexts.find((c) => c.origin === `chrome-extension://${extensionId}`);
    if (!world) throw new Error(`no pointcast content script world in ${page.url()}`);
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression,
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`content script evaluation failed: ${exceptionDetails.text}`);
    return result.value as T;
  } finally {
    await cdp.detach();
  }
}

/**
 * Sends a synthetic draft from the content script world with the same message the content
 * script's sendDraft() uses. atStart/atEnd are stamped in the page right before sending.
 */
export async function sendDraftFromContentScript(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  draft: Omit<CapturedEventDraft, "atStart" | "atEnd" | "url">,
): Promise<{ result: CaptureEventResult; atStart: number }> {
  // Built and typed here in Node, so the e2e breaks at compile time if the protocol changes.
  const message: OffscreenMessage = {
    to: "offscreen",
    type: "capture-event",
    draft: { ...draft, atStart: 0, atEnd: 0, url: "" },
  };
  const expression = `(async () => {
    const message = ${JSON.stringify(message)};
    const atStart = Date.now();
    Object.assign(message.draft, { atStart, atEnd: atStart, url: location.href });
    return { result: await chrome.runtime.sendMessage(message), atStart };
  })()`;
  return evaluateInContentScript(context, page, extensionId, expression);
}

/** Minimal ElementInfo for synthetic drafts: tests of the recorder that do not depend on DOM capture. */
export const SYNTHETIC_ELEMENT = {
  tag: "button",
  text: "Export",
  selector: "#export-btn",
  selectorUnique: true,
  path: "main › section#orders › div › button#export-btn",
  html: '<button type="button" id="export-btn">Export</button>',
} as const;
