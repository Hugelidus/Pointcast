import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { PORT_A, PORT_B } from "./support/paths";
import { evaluateInContentScript, startFromPopup, stopFromPopup } from "./support/recorder";

/** Selector of the REC badge inside the indicator's open shadow root (Playwright pierces it). */
const INDICATOR = "[data-pointcast-ui] .rec";

/** Local development hosts from D8, on both ports. myapp.test is mapped to 127.0.0.1 (fixtures.ts). */
const MATCHING_URLS = [
  `http://localhost:${PORT_B}/index.html`,
  `http://app.localhost:${PORT_A}/index.html`,
  `http://myapp.test:${PORT_B}/index.html`,
  `http://[::1]:${PORT_A}/index.html`,
];

async function openApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
}

test("REC indicator follows the recording on every local dev host and port", async ({
  context,
  extensionId,
  extensionPage: popup,
}) => {
  // Open before recording: the indicator must appear through storage change events.
  const first = await context.newPage();
  await openApp(first, `http://127.0.0.1:${PORT_A}/index.html`);
  // Wait until the content script is injected, so "no indicator" below means "idle", not "not yet".
  await expect.poll(() => evaluateInContentScript(context, first, extensionId, "1").catch(() => 0)).toBe(1);
  await expect(first.locator(INDICATOR)).toHaveCount(0);

  await startFromPopup(popup);
  await expect(first.locator(INDICATOR)).toBeVisible();
  await expect(first.locator(INDICATOR)).toHaveText("REC");
  // Never in the way of the app: clicks go through it.
  await expect(first.locator(INDICATOR)).toHaveCSS("pointer-events", "none");

  // Opened while recording: the indicator must appear from the initial state request.
  for (const url of MATCHING_URLS) {
    const page = await context.newPage();
    await openApp(page, url);
    await expect(page.locator(INDICATOR), url).toBeVisible();
  }

  // It comes back after a full reload.
  await first.reload();
  await expect(first.locator(INDICATOR)).toBeVisible();

  await stopFromPopup(popup);
  await expect(first.locator(INDICATOR)).toHaveCount(0);
});

test("the content script does not run on other hosts", async ({ context, extensionId, extensionPage: popup }) => {
  await startFromPopup(popup);
  const page = await context.newPage();
  // Served by the same local server, but under a host name outside D8's list.
  await openApp(page, `http://not-local.example:${PORT_A}/index.html`);
  await page.waitForTimeout(1000);
  await expect(page.locator(INDICATOR)).toHaveCount(0);
  await expect(evaluateInContentScript(context, page, extensionId, "1")).rejects.toThrow(
    /no pointcast content script world/,
  );
  await stopFromPopup(popup);
});
