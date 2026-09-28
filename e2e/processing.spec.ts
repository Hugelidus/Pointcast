import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { readSpokenWords, startsOf } from "./support/ground-truth";
import { FIXTURE_WAV, PORT_A, REPO_ROOT } from "./support/paths";
import {
  PROCESSING_TIMEOUT_MS,
  readE2eRecords,
  readSavedSession,
  setSettings,
  startFromPopup,
  waitForStatus,
} from "./support/recorder";
import { altClickAt, center, drag, INDICATOR, sleepUntil, textBox } from "./support/scenario";
import { readMonoSamples } from "./support/wav-file";

/**
 * Stop → Markdown inside the extension (D1 note 2026-09-27): the fake microphone plays the whole
 * es-short narration ("Esto me gustaría que estuviera filtrado por cantidad, y además esto que
 * exporte solo lo filtrado."), the test points at the table on each "esto", and Stop must end
 * with the Markdown on the clipboard, while the page, the toolbar badge and the popup show what
 * is going on. The e2e build records the clipboard write and the notification instead of
 * performing them (build-env.ts), and loads Whisper from the local model server
 * (playwright.config.ts), so nothing here touches the machine or the network.
 */

const APP = `http://127.0.0.1:${PORT_A}`;
const GROUND_TRUTH = path.join(REPO_ROOT, "fixtures", "audio", "es-short.words.json");

const PILL = "[data-pointcast-ui] .pill";
/** What the pill and the popup may say while working: the estimate, or the first model download. */
const WORKING = /^(Preparing…|Processing… (~\d+:\d\d|almost done)|Downloading the speech model \(first time only\)….*|Saving…)$/;

const AMBER = [227, 116, 0, 255];
const GREEN = [24, 128, 56, 255];

const badge = (popup: Page) => popup.evaluate(() => chrome.action.getBadgeText({}));
const badgeColor = (popup: Page) => popup.evaluate(() => chrome.action.getBadgeBackgroundColor({}));

test("Stop turns the narration into Markdown on the clipboard, and shows the progress everywhere", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  // Two recordings (12 s and 4 s), each processed, plus the first model load of a fresh profile.
  test.setTimeout(240_000);
  const [esto1, esto2] = startsOf(readSpokenWords(GROUND_TRUTH), "esto");
  if (esto1 === undefined || esto2 === undefined) throw new Error('es-short must say "esto" twice');
  const narration = readMonoSamples(readFileSync(FIXTURE_WAV));

  const app = await context.newPage();
  await app.goto(`${APP}/index.html`);
  const t0 = await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toHaveText("REC");
  expect(await badge(popup)).toBe("REC");

  const quantity = await textBox(app.getByRole("columnheader", { name: "Quantity" }));
  const exportButton = await center(app.locator("#export-btn"));
  await drag(app, { x: quantity.left + 1, y: quantity.midY }, { x: quantity.right - 1, y: quantity.midY }, t0 + esto1);
  await altClickAt(app, exportButton, t0 + esto2);
  // Stop once the narration has played through once (the fake microphone loops it).
  await sleepUntil(t0 + (narration.samples.length * 1000) / narration.sampleRate + 200);

  // ---- Stop: the popup, the badge and the page all say it is working.
  await popup.bringToFront();
  const stoppedAt = Date.now();
  await popup.locator("#toggle").click();
  await expect(popup.locator("#progress")).toBeVisible();
  await expect(popup.locator("#progress-text")).toHaveText(WORKING);
  await expect(popup.locator("#toggle")).toBeDisabled();
  await expect.poll(() => badge(popup)).toBe("…");
  expect(await badgeColor(popup)).toEqual(AMBER);
  await expect(app.locator(`${PILL}.processing`)).toHaveText(WORKING);
  await expect(app.locator(`${PILL}.processing .fill`)).toHaveCount(1);

  // ---- Done: copied, said in the page, on the badge and in a notification.
  const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  const stopToSavedMs = Date.now() - stoppedAt;
  expect(state.error).toBeUndefined();
  expect(state.lastResult).toMatchObject({ copied: true, sessionId: state.lastSessionId });
  // The ✓ is drawn apart from the words (indicator.ts), so the text has no space after it.
  await expect(app.locator(`${PILL}.done`)).toHaveText("✓Copied · saved to Downloads");
  expect(await badge(popup)).toBe("✓");
  expect(await badgeColor(popup)).toEqual(GREEN);

  const sessionId = state.lastSessionId as string;
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  // Audio is not kept by default (session format v2).
  expect(readdirSync(saved.folder).sort()).toEqual(["session.json", "session.md", "words.json"]);
  expect(saved.session.audio).toBeUndefined();
  expect(saved.session.events.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}»`)).toEqual([
    "select th «Quantity»",
    "point button «Export»",
  ]);
  // Language detected (Auto is the default), and both "esto" transcribed.
  expect(saved.words.language).toBe("es");
  expect(saved.words.engine).toBe("local:Xenova/whisper-base");
  expect(saved.words.words.filter((w) => /^\s*esto\b/i.test(w.text))).toHaveLength(2);
  // Each gesture sits next to its "esto" in the spec (the default "requests" format), with the
  // section it is in (ElementInfo.context).
  expect(saved.markdown).toMatch(/> Esto,? \[a\][^\n]*\n\n- \[a\] th «Quantity» in «Orders» \(selected\)/);
  expect(saved.markdown).toMatch(/> [^\n]*esto,? \[a\][^\n]*\n\n- \[a\] button «Export» in «Orders»[^\n]*\n {2}- find: [^\n]*Toolbar\.tsx:8/);

  const records = await readE2eRecords(popup);
  expect(records.filter((r) => r.kind === "clipboard")).toEqual([{ kind: "clipboard", text: saved.markdown }]);
  expect(records.filter((r) => r.kind === "notification")).toEqual([
    {
      kind: "notification",
      title: "Pointcast",
      message: `Copied. Paste it into your agent. Saved to Downloads/pointcast/${sessionId}/`,
    },
  ]);

  // ---- The popup's details: copied, where it went, how long the audio is, Copy again, Show in folder.
  await expect(popup.locator("#progress")).toBeHidden();
  await expect(popup.locator("#message")).toHaveText("Copied. Paste it into your agent.");
  await expect(popup.locator("#where-label")).toHaveText("Saved to Downloads › pointcast");
  await expect(popup.locator("#where-path")).toHaveText(sessionId);
  await expect(popup.locator("#where-path")).toHaveAttribute("title", `Downloads/pointcast/${sessionId}/`);
  await expect(popup.locator("#result-meta")).toHaveText(/^0:1\d of audio · 2 events$/);
  await expect(popup.locator("#warning")).toBeHidden();
  await popup.locator("#copy-again").click();
  await expect(popup.locator("#copy-again")).toHaveText("Copied ✓");
  await popup.locator("#show-folder").click();
  await expect
    .poll(async () => (await readE2eRecords(popup)).slice(-2))
    .toEqual([
      { kind: "clipboard", text: saved.markdown },
      { kind: "show-in-folder", downloadId: state.lastResult?.downloadId },
    ]);

  // ---- A few seconds later the page and the badge are clean again.
  await expect(app.locator(PILL)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => badge(popup), { timeout: 10_000 }).toBe("");

  const stats = (await popup.evaluate(() => chrome.storage.local.get("processingStats")))["processingStats"];
  expect(stats).toMatchObject({ modelReady: true, lastLanguage: "es" });
  console.log(
    `es-short (${(saved.session.durationMs / 1000).toFixed(1)} s of audio): Stop → Markdown saved in ${stopToSavedMs} ms ` +
      `(extension measured ${state.lastResult?.processingMs} ms, first run: model loaded from the local server into the Cache API). ` +
      `Learned speed: ${JSON.stringify(stats)}`,
  );

  // ---- Second session: cached model, the language picked in the popup, an estimate from this run.
  await setSettings(popup, { language: "es" });
  await startFromPopup(popup);
  await popup.waitForTimeout(4_000);
  const secondStop = Date.now();
  await popup.locator("#toggle").click();
  await expect(popup.locator("#progress-text")).toHaveText(/^(Processing… (~\d+:\d\d|almost done)|Saving…)$/);
  const second = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  const secondMs = Date.now() - secondStop;
  expect(second.error).toBeUndefined();
  expect(second.lastSessionId).not.toBe(sessionId);
  const secondSaved = await readSavedSession(popup, downloadsDir, second.lastSessionId as string);
  expect(secondSaved.words.language).toBe("es");
  console.log(`second session (${(secondSaved.session.durationMs / 1000).toFixed(1)} s, cached model): Stop → saved in ${secondMs} ms`);
});

test("the permission page and the popup still work in a cross-origin isolated extension", async ({ context, extensionId }) => {
  // COOP/COEP (for multi-threaded WASM) apply to every extension page: check both load and run.
  const permission = await context.newPage();
  await permission.goto(`chrome-extension://${extensionId}/permission.html`);
  expect(await permission.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  // The fake media UI grants the microphone, so the page reads the permission and says so.
  await expect(permission.locator("#result")).toContainText("Microphone allowed");
  expect(await permission.evaluate(async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).active)).toBe(true);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#toggle")).toHaveText("Record");
  await expect(popup.locator(".brand img")).toHaveJSProperty("naturalWidth", 32);
  // The settings are in the popup, with Auto-detect as the default language.
  await expect(popup.locator("#language")).toHaveValue("auto");
  await expect(popup.locator("#language option")).toHaveCount(100);
});
