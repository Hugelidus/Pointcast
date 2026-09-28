import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readRecorder, readSavedSession, setSettings, startFromPopup, stopFromPopup } from "./support/recorder";

/**
 * Debug capture (D13) in the real browser, on dev/playground/errors.html: what failed on the page
 * around a gesture is listed under its element in the spec, in voice and in typed mode; a gesture
 * with nothing around it renders as before; with the setting off the page is never hooked.
 */

const APP = `http://127.0.0.1:${PORT_A}/errors.html`;
const NOTE_BOX = '[data-pointcast-ui="note"]';

/** The server answers the export with a 500 and the orders with a 503 (the playground's own server has neither). */
async function brokenApi(app: Page): Promise<void> {
  await app.route("**/api/export", (route) => route.fulfill({ status: 500, body: "{}" }));
  await app.route("**/api/orders*", (route) => route.fulfill({ status: 503, body: "" }));
}

/** Whether the page's fetch and console.error are the browser's own (not hooked). */
function nativeHooks(app: Page): Promise<boolean[]> {
  return app.evaluate(() => [fetch, console.error, XMLHttpRequest.prototype.open].map((f) => /\[native code\]/.test(Function.prototype.toString.call(f))));
}

/** Plain clicks that fail: a 500 and its console.error, then an uncaught TypeError. */
async function breakThings(app: Page): Promise<void> {
  await app.locator("#broken-export").click();
  await expect(app.locator("#broken-export")).toBeVisible();
  await app.waitForTimeout(300);
  await app.locator("#broken-archive").click();
  await app.waitForTimeout(300);
}

/** The element's block in the requests format: from its "- [x]" line to the next blank line. */
function elementBlock(markdown: string, head: string): string {
  const start = markdown.indexOf(head);
  if (start < 0) throw new Error(`no "${head}" in:\n${markdown}`);
  const end = markdown.indexOf("\n\n", start);
  return markdown.slice(start, end < 0 ? undefined : end);
}

const EXPECTED_ERRORS = [
  /^ {2}- errors around this moment:$/m,
  /^ {4}- network: `GET \/api\/orders\?status&page` → 503 \(\d+\.\d s before\)$/m,
  /^ {4}- network: `POST \/api\/export` → 500 \(\d+\.\d s before\)$/m,
  /^ {4}- console\.error: `Export failed: 500` at `errors\.js:17` \(\d+\.\d s before\)$/m,
  /^ {4}- uncaught: `TypeError: Cannot read properties of undefined \(reading 'rows'\)` at `errors\.js:22` \(\d+\.\d s before\)$/m,
];

test("typed mode: the errors before the Alt+click are listed under the element; a quiet gesture renders as before", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  test.setTimeout(120_000);
  await setSettings(popup, { inputMode: "typed" });
  await popup.reload();
  const app = await context.newPage();
  await brokenApi(app);
  await app.goto(APP);
  // Before Record: nothing is hooked, and the failed load is not part of the recording.
  expect(await nativeHooks(app)).toEqual([true, true, true]);

  await startFromPopup(popup);
  expect((await readRecorder(popup)).state.captureErrors).toBe(true);
  await app.bringToFront();
  await expect.poll(() => nativeHooks(app)).toEqual([false, false, false]);
  // A page loaded during the recording is hooked at document_start: its first request is caught.
  await app.reload();
  await expect(app.locator("#orders-status")).toHaveText("Could not load orders");
  await breakThings(app);

  // ---- "This button does nothing": the errors are next to it.
  await app.locator("#broken-export").click({ modifiers: ["Alt"] });
  await expect(app.locator(NOTE_BOX)).toBeFocused();
  await app.keyboard.type("This button does nothing");
  await app.keyboard.press("Enter");
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);

  // ---- More than 5 s later, a gesture with nothing around it.
  await app.waitForTimeout(5_500);
  await app.locator("#working-refresh").click({ modifiers: ["Alt"] });
  await expect(app.locator(NOTE_BOX)).toBeFocused();
  await app.keyboard.type("Rename this to Reload");
  await app.keyboard.press("Enter");
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(2);

  const { sessionId } = await stopFromPopup(popup);
  // Released at Stop: the page's own functions are back.
  await expect.poll(() => nativeHooks(app)).toEqual([true, true, true]);
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  const [broken, quiet] = saved.session.events;
  expect(broken?.errors?.map((e) => e.kind)).toEqual(["network", "network", "console-error", "error"]);
  expect(quiet).not.toHaveProperty("errors");
  expect(saved.session.errors).toHaveLength(4);

  const block = elementBlock(saved.markdown, "- [a] button «Export»");
  for (const line of EXPECTED_ERRORS) expect(block).toMatch(line);
  expect(saved.markdown).toContain("> This button does nothing [a]");
  // The quiet gesture's block has no error line, exactly as without debug capture.
  expect(elementBlock(saved.markdown, "- [a] button «Refresh»")).not.toContain("errors around");
  // Never a body, a query value or the machine's path.
  expect(saved.markdown).not.toContain("csv");
  expect(saved.markdown).not.toContain("status=open");
  expect(JSON.stringify(saved.session)).not.toMatch(/Users|hugob/);
});

test("voice mode: the same errors under the pointed element", async ({ context, extensionPage: popup, downloadsDir }) => {
  test.setTimeout(180_000);
  await setSettings(popup, { language: "es" });
  const app = await context.newPage();
  await brokenApi(app);
  await app.goto(APP);
  await startFromPopup(popup);
  await app.bringToFront();
  await expect.poll(() => nativeHooks(app)).toEqual([false, false, false]);
  await app.reload();
  await expect(app.locator("#orders-status")).toHaveText("Could not load orders");
  await breakThings(app);
  await app.locator("#broken-export").click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);
  await app.waitForTimeout(1_500);

  const { sessionId } = await stopFromPopup(popup);
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  expect(saved.session.inputMode).toBeUndefined();
  const block = elementBlock(saved.markdown, "] button «Export»");
  for (const line of EXPECTED_ERRORS) expect(block).toMatch(line);
});

test("with the setting off, the page is never hooked and the spec has no errors", async ({ context, extensionPage: popup, downloadsDir }) => {
  await setSettings(popup, { inputMode: "typed", captureErrors: false });
  await popup.reload();
  await popup.locator("details.settings > summary").click();
  await expect(popup.locator("#capture-errors")).not.toBeChecked();
  const app = await context.newPage();
  await brokenApi(app);
  await app.goto(APP);
  await startFromPopup(popup);
  expect((await readRecorder(popup)).state.captureErrors).toBeUndefined();
  await app.bringToFront();
  await breakThings(app);
  await app.locator("#broken-export").click({ modifiers: ["Alt"] });
  await expect(app.locator(NOTE_BOX)).toBeFocused();
  expect(await nativeHooks(app)).toEqual([true, true, true]);
  await app.keyboard.type("This button does nothing");
  await app.keyboard.press("Enter");
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);

  const { sessionId } = await stopFromPopup(popup);
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  expect(saved.session).not.toHaveProperty("errors");
  expect(saved.session.events[0]).not.toHaveProperty("errors");
  expect(saved.markdown).not.toMatch(/errors around|Errors during/);
});
