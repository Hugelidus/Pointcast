import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { SessionFile } from "../../packages/core/src/schema";
import { ERROR_VISIBLE_MS } from "../../packages/extension/src/processing/progress";
import {
  contentScriptWorlds,
  countContentScriptStarts,
  disableAndEnableExtension,
  reloadExtension,
} from "./support/extension";
import { expect, test } from "./support/fixtures";
import { EXTENSION_DIR, PORT_A } from "./support/paths";
import { evaluateInContentScript, readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/**
 * Chrome injects manifest content scripts only into pages loaded AFTER the extension is
 * installed, updated or reloaded. A page that was already open keeps the old copy, which lost
 * its connection to the extension: it never hears that a recording started, so Alt+click
 * executes the app's action and the session ends with no events (a real 48.8 s recording with
 * "events": []). These tests open the page first and reload the extension afterwards, which
 * the rest of the suite never does.
 */

const APP_URL = `http://127.0.0.1:${PORT_A}/index.html`;
/** The REC badge's host element: counts copies of the indicator, not just visibility. */
const INDICATOR_HOST = '[data-pointcast-ui="indicator"]';

/** Opens the playground and waits for the manifest content script to be there. */
async function openApp(page: Page, extensionId: string): Promise<void> {
  await page.goto(APP_URL);
  await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
  await expect.poll(() => evaluateInContentScript(page.context(), page, extensionId, "1").catch(() => 0)).toBe(1);
}

function orderRows(page: Page) {
  return page.locator("#orders-table tbody tr");
}

async function altClickDelete(page: Page, order: string): Promise<void> {
  await page.bringToFront();
  await orderRows(page).filter({ hasText: order }).getByRole("button", { name: "Delete" }).click({ modifiers: ["Alt"] });
  // Leave time for the app to react, if the click was not cancelled.
  await page.waitForTimeout(300);
}

function summary(session: SessionFile): string[] {
  return session.events.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}» ${e.url}`);
}

test("a tab opened after the extension loaded, before recording, is captured", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await openApp(app, extensionId);
  const starts = await countContentScriptStarts(app, extensionId);

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  await expect(app.locator(INDICATOR_HOST)).toHaveCount(1);
  await altClickDelete(app, "#1001");
  await expect(orderRows(app)).toHaveCount(4);
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(summary(session)).toEqual([`point button «Delete» ${APP_URL}`]);
  // The page's own copy answered, so starting the recording injected nothing more.
  expect(await starts()).toBe(0);
});

test("a tab left open across an extension reload is captured", async ({ context, extensionId, downloadsDir }) => {
  const app = await context.newPage();
  await openApp(app, extensionId);
  const starts = await countContentScriptStarts(app, extensionId);

  const popup = await reloadExtension(context, extensionId);
  console.log(`extension worlds in the page after the reload: ${await contentScriptWorlds(context, app, extensionId)}`);

  await startFromPopup(popup);
  await app.bringToFront();
  // Soft: when capture is missing, report every symptom the user saw, not only the first.
  await expect.soft(app.locator(INDICATOR), "REC indicator").toBeVisible();
  await altClickDelete(app, "#1001");
  await expect.soft(orderRows(app), "Alt+click must not delete the row").toHaveCount(4);
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect.soft(summary(session), "events in session.json").toEqual([`point button «Delete» ${APP_URL}`]);
  // One new copy, injected once: not again when the recording started.
  expect.soft(await starts(), "content script copies started after the reload").toBe(1);
  // REC ends with the recording; the pill then shows the outcome for a few seconds and goes away.
  // A recording this short is often "not sure which language" (a warning), which stays
  // ERROR_VISIBLE_MS after it was saved rather than the 5 s of a plain "✓ Copied".
  await expect(app.locator(INDICATOR)).toHaveCount(0);
  await expect(app.locator(INDICATOR_HOST)).toHaveCount(0, { timeout: ERROR_VISIBLE_MS + 5_000 });
});

test("a tab left open while the extension was disabled and enabled again is attached when recording starts", async ({
  context,
  extensionId,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await openApp(app, extensionId);
  const starts = await countContentScriptStarts(app, extensionId);

  const popup = await disableAndEnableExtension(context, extensionId);
  // No install event for this, so nothing was injected yet: the Record press must do it.
  await popup.waitForTimeout(500);
  expect(await starts(), "copies started before Record").toBe(0);

  await startFromPopup(popup);
  expect(await starts(), "copies started by Record").toBe(1);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  await altClickDelete(app, "#1001");
  await expect(orderRows(app)).toHaveCount(4);
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(summary(session)).toEqual([`point button «Delete» ${APP_URL}`]);
});

test("reloading the extension while recording releases the page; the next recording has one capturing copy", async ({
  context,
  extensionId,
  extensionPage: firstPopup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await openApp(app, extensionId);
  await startFromPopup(firstPopup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();

  // The recording dies with the old instance (its offscreen document is closed).
  const popup = await reloadExtension(context, extensionId);
  await expect(popup.locator("#status")).toHaveText("Idle");

  // The old copy was capturing when it was cut off. It must let go of the page: no stale REC
  // badge, and Alt+click reaches the app again because nothing is recording.
  await expect.soft(app.locator(INDICATOR_HOST), "stale REC indicator").toHaveCount(0);
  await altClickDelete(app, "#1001");
  await expect.soft(orderRows(app), "Alt+click while idle is the app's").toHaveCount(3);

  // Recording again: exactly one copy shows the badge and records each Alt+click.
  await startFromPopup(popup);
  await app.bringToFront();
  await expect.soft(app.locator(INDICATOR), "REC indicator").toBeVisible();
  await expect.soft(app.locator(INDICATOR_HOST), "one REC indicator").toHaveCount(1);
  await altClickDelete(app, "#1002");
  await expect.soft(orderRows(app), "Alt+click must not delete the row").toHaveCount(3);
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(summary(session), "events in session.json").toEqual([`point button «Delete» ${APP_URL}`]);
});

test("a second copy started in the same extension instance replaces the first: one badge, one event per gesture", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await openApp(app, extensionId);
  const starts = await countContentScriptStarts(app, extensionId);

  // Run the built content script again in its own world, as a second injection would.
  const bundle = readFileSync(path.join(EXTENSION_DIR, "content-scripts", "content.js"), "utf8");
  await evaluateInContentScript(context, app, extensionId, bundle);
  expect(await starts()).toBe(1);

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  await expect(app.locator(INDICATOR_HOST)).toHaveCount(1);
  await altClickDelete(app, "#1001");
  await expect(orderRows(app)).toHaveCount(4);
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(summary(session)).toEqual([`point button «Delete» ${APP_URL}`]);
});
