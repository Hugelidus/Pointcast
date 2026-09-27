import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import {
  readSavedSession,
  savedWav,
  sendDraftFromContentScript,
  setSettings,
  startFromPopup,
  stopFromPopup,
  SYNTHETIC_ELEMENT,
} from "./support/recorder";

test("recording survives a full page navigation (index.html -> other.html)", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  // The audio is checked below, so keep it (it is not saved by default).
  await setSettings(popup, { keepAudio: true });
  const t0 = await startFromPopup(popup);

  await app.waitForTimeout(800);
  const before = await sendDraftFromContentScript(context, app, extensionId, { gesture: "click", element: SYNTHETIC_ELEMENT });
  expect(before.result).toEqual({ accepted: true, id: "e1" });

  // A real link click: a plain click, so it is not recorded (D7, 2026-09-26), but it still
  // navigates normally, and the full page load destroys and re-injects the content script.
  await app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Customers" }).click();
  await app.waitForURL(`http://127.0.0.1:${PORT_A}/other.html`);
  await expect(app.locator("[data-pointcast-ui] .rec")).toBeVisible();

  await app.waitForTimeout(800);
  const after = await sendDraftFromContentScript(context, app, extensionId, { gesture: "click", element: SYNTHETIC_ELEMENT });
  // Ids keep counting across the reload: the uncaptured link click leaves no gap.
  expect(after.result).toEqual({ accepted: true, id: "e2" });

  await app.waitForTimeout(500);
  const { stoppedAt, sessionId } = await stopFromPopup(popup);
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  const { session } = saved;
  const wav = savedWav(saved);

  expect(session.events.map((e) => [e.id, e.gesture, e.url, e.element.text])).toEqual([
    ["e1", "click", `http://127.0.0.1:${PORT_A}/index.html`, SYNTHETIC_ELEMENT.text],
    ["e2", "click", `http://127.0.0.1:${PORT_A}/other.html`, SYNTHETIC_ELEMENT.text],
  ]);
  expect(session.events.map((e) => e.tStart)).toEqual([before.atStart - t0, after.atStart - t0]);
  // Uninterrupted: the audio still spans the whole session, navigation included.
  expect(Math.abs(wav.durationMs - (stoppedAt - t0))).toBeLessThan(500);
  expect(wav.rms).toBeGreaterThan(0.01);
});
