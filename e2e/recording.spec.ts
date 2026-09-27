import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import {
  readRecorder,
  readSavedSession,
  savedWav,
  sendDraftFromContentScript,
  setSettings,
  startFromPopup,
  stopFromPopup,
  SYNTHETIC_ELEMENT,
} from "./support/recorder";

const RECORD_MS = 3000;

test("popup Record/Stop saves a 16 kHz mono WAV and a valid session.json when the audio is kept", async ({
  extensionPage: popup,
  downloadsDir,
}) => {
  await setSettings(popup, { keepAudio: true });
  const t0 = await startFromPopup(popup);
  await popup.waitForTimeout(RECORD_MS);
  await expect(popup.locator("#elapsed")).not.toHaveText("00:00");
  const { stoppedAt, sessionId } = await stopFromPopup(popup);

  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  const { session } = saved;
  const wav = savedWav(saved);
  expect(wav).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  // The audio must cover the time between the recorder start (t0) and the Stop press.
  expect(Math.abs(wav.durationMs - (stoppedAt - t0))).toBeLessThan(500);
  // Not silence: the fake microphone file really went through MediaRecorder and the resampler.
  expect(wav.rms).toBeGreaterThan(0.01);

  expect(session.id).toBe(sessionId);
  expect(session.t0).toBe(t0);
  expect(session.durationMs).toBe(Math.round(wav.durationMs));
  expect(session.events).toEqual([]);
});

test("a draft sent from the content script lands in session.json as e1 with a time relative to t0", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);

  const t0 = await startFromPopup(popup);
  // Nothing captured yet: no "Last:" line.
  await expect(popup.locator("#last-event")).toBeHidden();
  await app.waitForTimeout(700);
  const { result, atStart } = await sendDraftFromContentScript(context, app, extensionId, {
    gesture: "point",
    element: SYNTHETIC_ELEMENT,
  });
  expect(result).toEqual({ accepted: true, id: "e1" });
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);
  await expect(popup.locator("#events")).toHaveText("1");
  // The recorder's summary of the event it accepted, next to the count.
  await expect(popup.locator("#last-event")).toHaveText("Last: button «Export» · Alt+click");
  await popup.waitForTimeout(500);
  const { sessionId } = await stopFromPopup(popup);
  await expect(popup.locator("#last-event")).toBeHidden();

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.events).toHaveLength(1);
  const [event] = session.events;
  expect(event).toEqual({
    id: "e1",
    gesture: "point",
    tStart: atStart - t0,
    tEnd: atStart - t0,
    url: `http://127.0.0.1:${PORT_A}/index.html`,
    element: SYNTHETIC_ELEMENT,
  });
  expect(event?.tStart).toBeGreaterThanOrEqual(700);
  expect(event?.tStart).toBeLessThan(session.durationMs);

  // A new recording starts with nothing captured: the previous one's last event is gone.
  await startFromPopup(popup);
  expect(await readRecorder(popup)).toMatchObject({ eventCount: 0, lastEvent: null });
  await expect(popup.locator("#events")).toHaveText("0");
  await expect(popup.locator("#last-event")).toBeHidden();
  await popup.waitForTimeout(500);
  await stopFromPopup(popup);
});

test("drafts get no answer when nothing is recording", async ({ context, extensionId }) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  // No offscreen document exists and the service worker ignores drafts, so the message
  // resolves with no answer; the content script's sendDraft() maps that to { accepted: false }.
  const { result } = await sendDraftFromContentScript(context, app, extensionId, {
    gesture: "click",
    element: SYNTHETIC_ELEMENT,
  });
  expect(result).toBeUndefined();
});
