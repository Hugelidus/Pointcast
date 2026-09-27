import { TOGGLE_RECORDING_COMMAND } from "../packages/extension/src/shortcut";
import { setCommandShortcut } from "./support/extension";
import { expect, test } from "./support/fixtures";

/**
 * The Record/Stop keyboard shortcut. Pressing it is NOT tested here, because it cannot be:
 * Chrome handles extension shortcuts as browser accelerators, before any page sees the keys,
 * while Playwright's keyboard delivers key events to a page (and a headless browser has no
 * focused window for an accelerator anyway). Nor can a test fire chrome.commands.onCommand.
 * What the shortcut does is covered by unit tests instead: background/shortcut.test.ts (the
 * handler), commands.test.ts "toggleRecording" (same start/stop as the popup, including the
 * permission page) and startup.test.ts (listener registered in the worker's first turn, D6).
 *
 * This checks the rest in the real browser: Chrome accepted the manifest's suggested key (it
 * silently refuses keys it keeps for itself, see src/shortcut.ts), and the popup shows the
 * binding Chrome has, which the user can change or remove. Chrome reports bindings in the
 * browser's language and platform style ("Alt+Mayús+S", "⌥⇧S"), so they are compared with
 * what chrome.commands.getAll returns rather than spelled out here.
 */

const HINT = " starts or stops recording without opening this popup.";

test("the popup shows the Record/Stop shortcut Chrome has, also after the user changes or removes it", async ({
  context,
  extensionId,
  extensionPage: popup,
}) => {
  const binding = async () =>
    (await popup.evaluate(() => chrome.commands.getAll())).find((c) => c.name === TOGGLE_RECORDING_COMMAND)?.shortcut;

  // Chrome assigned the suggested key (a blank shortcut would mean it keeps the key for itself).
  const suggested = await binding();
  expect(suggested, "Chrome did not assign the suggested key").toMatch(/S$/);
  await expect(popup.locator("#shortcut")).toHaveText(`${suggested}${HINT}`);

  // What chrome://extensions/shortcuts does when the user records other keys, then clears them.
  await setCommandShortcut(context, extensionId, TOGGLE_RECORDING_COMMAND, "Alt+Shift+Y");
  await expect.poll(binding).toMatch(/Y$/);
  await popup.reload();
  await expect(popup.locator("#shortcut")).toHaveText(`${await binding()}${HINT}`);

  await setCommandShortcut(context, extensionId, TOGGLE_RECORDING_COMMAND, "");
  await expect.poll(binding).toBe("");
  await popup.reload();
  await expect(popup.locator("#shortcut")).toHaveText(
    "No keyboard shortcut for Record/Stop: set one in chrome://extensions/shortcuts.",
  );
});
