import { pathToFileURL } from "node:url";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { newPageWithTabId } from "./support/extension";
import { expect, test } from "./support/fixtures";
import { PORT_A, REPO_ROOT } from "./support/paths";
import { startFromPopup, stopFromPopup } from "./support/recorder";

/**
 * The popup says whether the active tab is captured, so a recording that captures nothing
 * cannot go unnoticed. The suite opens popup.html as a tab of its own, so it names the tab to
 * report on with ?tab=<id> (in real use: the active tab of the popup's window).
 */

const NOT_LOCAL =
  /^This tab is not captured: pointcast only runs on local dev hosts \(localhost, .*\), not on file:\/\/ pages or remote sites\.$/;
const UNAVAILABLE = /^This tab is not captured: pointcast could not attach to it \(.+\)\. Reload the page\.$/;

async function openPopupFor(context: BrowserContext, extensionId: string, tabId: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  return popup;
}

test("a tab on a local dev host: ready, then capturing", async ({ context, extensionId, extensionPage }) => {
  const { page: app, tabId } = await newPageWithTabId(context, extensionPage);
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  const popup = await openPopupFor(context, extensionId, tabId);
  const status = popup.locator("#tab-status");

  await expect(status).toHaveText("This tab will be captured when you record.");
  await expect(status).toHaveAttribute("data-tone", "ok");
  await startFromPopup(popup);
  await expect(status).toHaveText("Capturing this tab.");
  await stopFromPopup(popup);
  await expect(status).toHaveText("This tab will be captured when you record.");
});

test("a remote site and a file:// page are not captured, which is an error while recording", async ({
  context,
  extensionId,
  extensionPage,
}) => {
  // Served by the local test server, but under a host name outside D8's list (fixtures.ts).
  const remote = await newPageWithTabId(context, extensionPage);
  await remote.page.goto(`http://not-local.example:${PORT_A}/index.html`);
  const file = await newPageWithTabId(context, extensionPage);
  await file.page.goto(pathToFileURL(path.join(REPO_ROOT, "playground", "index.html")).href);

  for (const { tabId } of [remote, file]) {
    const popup = await openPopupFor(context, extensionId, tabId);
    const status = popup.locator("#tab-status");
    await expect(status).toHaveText(NOT_LOCAL);
    await expect(status).toHaveAttribute("data-tone", "warning");
    await popup.close();
  }

  const popup = await openPopupFor(context, extensionId, file.tabId);
  await startFromPopup(popup);
  await expect(popup.locator("#tab-status")).toHaveText(NOT_LOCAL);
  await expect(popup.locator("#tab-status")).toHaveAttribute("data-tone", "error");
  await stopFromPopup(popup);
  // Never touched: no content script was injected into either page.
  for (const { page } of [remote, file]) await expect(page.locator("[data-pointcast-ui]")).toHaveCount(0);
});

test("a local tab that cannot be attached is reported, and does not stop the recording", async ({
  context,
  extensionId,
  extensionPage,
}) => {
  // A Chrome error page at a local URL (Chrome refuses port 1 before sending anything): the
  // tab's URL is local, but Chrome lets no extension script into an error page.
  const broken = await newPageWithTabId(context, extensionPage);
  await broken.page.goto("http://127.0.0.1:1/").catch(() => undefined);

  const popup = await openPopupFor(context, extensionId, broken.tabId);
  const status = popup.locator("#tab-status");
  await expect(status).toHaveText(UNAVAILABLE);
  await expect(status).toHaveAttribute("data-tone", "warning");
  console.log(`error page: ${await status.textContent()}`);

  // Starting attaches every local tab; this one fails, and the recording starts anyway.
  await startFromPopup(popup);
  await expect(status).toHaveText(UNAVAILABLE);
  await expect(status).toHaveAttribute("data-tone", "error");
  await stopFromPopup(popup);
});
