import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readRecorder, readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/** Undo (D7 note 2026-09-27) through the popup button, in the real browser. */
test("Undo in the popup drops the last gesture: the session keeps only the first", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  await startFromPopup(popup);
  // Nothing to undo yet: the button is shown while recording, but disabled.
  await expect(popup.locator("#undo")).toBeVisible();
  await expect(popup.locator("#undo")).toBeDisabled();

  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  await app.locator("#export-btn").click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);
  await app.getByRole("columnheader", { name: "Quantity" }).click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(2);

  await popup.bringToFront();
  await expect(popup.locator("#undo")).toBeEnabled();
  await popup.locator("#undo").click();
  await expect(popup.locator("#message")).toHaveText("Undone: column header “Quantity”");
  await expect(popup.locator("#events")).toHaveText("1");
  expect(await readRecorder(popup)).toMatchObject({ eventCount: 1, lastEvent: "button «Export» · Alt+click" });

  const { sessionId } = await stopFromPopup(popup);
  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.events.map((e) => `${e.id} ${e.gesture} ${e.element.tag} «${e.element.text}»`)).toEqual([
    "e1 point button «Export»",
  ]);
});
