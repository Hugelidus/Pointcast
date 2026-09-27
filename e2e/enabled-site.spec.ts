import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { sitePattern } from "../packages/extension/src/sites";
import { newPageWithTabId } from "./support/extension";
import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { evaluateInContentScript, readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/**
 * pointcast on a site the user enabled (D8 note 2026-09-27). not-local.example is served by the
 * local playground server (fixtures.ts maps it to 127.0.0.1), but it is not a local dev host, so
 * nothing runs there until the site is enabled.
 */

const SITE = `http://not-local.example:${PORT_A}`;
const HOST = "not-local.example";

/**
 * Enables the site of `url` the way the popup's "Enable on <host>" button does: the same pattern
 * (sitePattern), requested with chrome.permissions.request from an extension page.
 *
 * The popup itself cannot be driven here: it offers the button only for the tab it was opened
 * on from the toolbar (activeTab), and a test can only open it as a tab of its own. Nor can
 * headless Chrome show the permission prompt. So the user's "Allow" is given first through the
 * API behind chrome://extensions' site access settings; Chrome does not prompt again for a host
 * the user already granted, and the request resolves at once. What the extension does next
 * (permissions.onAdded → register the content scripts, attach to open tabs) is the real path.
 */
async function enableSite(context: BrowserContext, extensionId: string, extensionPage: Page, url: string): Promise<void> {
  const pattern = sitePattern(url);
  if (pattern === undefined) throw new Error(`${url} is not a site that can be enabled`);
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://extensions");
    await settings.evaluate(
      ([id, host]) => {
        const api = (globalThis as unknown as { chrome: { developerPrivate: { addHostPermission(id: string, host: string): Promise<void> } } })
          .chrome.developerPrivate;
        return api.addHostPermission(id, host);
      },
      [extensionId, pattern] as const,
    );
  } finally {
    await settings.close();
  }
  // Chrome refuses a pattern that no single optional_host_permissions entry contains.
  const granted = await extensionPage.evaluate(
    (origins) => chrome.permissions.request({ origins }).catch((error: Error) => error.message),
    [pattern],
  );
  expect(granted, `chrome.permissions.request(${pattern})`).toBe(true);
}

async function openPopupFor(context: BrowserContext, extensionId: string, tabId: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  return popup;
}

/** Whether a live pointcast content script runs in `page` (its isolated world answers). */
function hasContentScript(context: BrowserContext, page: Page, extensionId: string): Promise<boolean> {
  return evaluateInContentScript<number>(context, page, extensionId, "1").then(
    (value) => value === 1,
    () => false,
  );
}

test("Enable on a site: its open tab and its later pages are captured, Alt+click included", async ({
  context,
  extensionId,
  extensionPage,
  downloadsDir,
}) => {
  const { page: open, tabId } = await newPageWithTabId(context, extensionPage);
  await open.goto(`${SITE}/index.html`);
  await open.waitForTimeout(500);
  expect(await hasContentScript(context, open, extensionId)).toBe(false);

  await enableSite(context, extensionId, extensionPage, `${SITE}/index.html`);
  // The tab that was already open is attached without a reload.
  await expect.poll(() => hasContentScript(context, open, extensionId)).toBe(true);
  const popup = await openPopupFor(context, extensionId, tabId);
  await expect(popup.locator("#site-toggle")).toHaveText(`Remove ${HOST}`);
  await expect(popup.locator("#tab-status")).toHaveText("This tab will be captured when you record.");

  // A page loaded after enabling gets the registered content scripts.
  const later = await context.newPage();
  await later.goto(`${SITE}/other.html`);

  await startFromPopup(popup);
  for (const page of [open, later]) await expect(page.locator(INDICATOR)).toBeVisible();
  await open.bringToFront();
  await open.locator("#export-btn").click({ modifiers: ["Alt"] });
  // Pointing, not using: the app's Export handler never ran.
  await expect(popup.locator("#last-event")).toHaveText("Last: button «Export» · Alt+click");
  await expect(open.locator("#toast")).toHaveText("");
  await later.bringToFront();
  await later.getByRole("button", { name: "View orders" }).first().click({ modifiers: ["Alt"] });
  await expect(popup.locator("#last-event")).toHaveText("Last: button «View orders» · Alt+click");
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.events.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}» ${e.url}`)).toEqual([
    `point button «Export» ${SITE}/index.html`,
    `point button «View orders» ${SITE}/other.html`,
  ]);
});

test("on an enabled site, emails and phone numbers in the page and in the URL are redacted", async ({
  context,
  extensionId,
  extensionPage,
  downloadsDir,
}) => {
  const email = "jane.cooper@example.com";
  const phone = "+34 612 345 678";
  // The customer's email and phone in the query, as a search or detail page would have them.
  const url = `${SITE}/other.html?email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`;
  const { page: app, tabId } = await newPageWithTabId(context, extensionPage);
  await app.goto(url);
  await enableSite(context, extensionId, extensionPage, url);
  await expect.poll(() => hasContentScript(context, app, extensionId)).toBe(true);
  // The first card shows the email (playground/other.html); give it a phone number too.
  const card = app.locator("article").first();
  await card.locator("p").evaluate((p, text) => p.insertAdjacentHTML("afterend", `<p class="phone">${text}</p>`), phone);
  await expect(card).toContainText(phone);

  const popup = await openPopupFor(context, extensionId, tabId);
  await startFromPopup(popup);
  await app.bringToFront();
  await card.locator("p").first().click({ modifiers: ["Alt"] });
  await expect(popup.locator("#last-event")).toHaveText("Last: p «[redacted]» · Alt+click");
  await card.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect(popup.locator("#last-event")).toContainText("Last: article «Jane Cooper [redacted]");
  const { sessionId } = await stopFromPopup(popup);

  const { folder, session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.events.map((e) => `${e.element.tag} «${e.element.text}»`)).toEqual([
    "p «[redacted]»",
    "article «Jane Cooper [redacted] [redacted] View orders»",
  ]);
  for (const event of session.events) {
    expect(event.url).toBe(`${SITE}/other.html?email=[redacted]&phone=[redacted]`);
    expect(event.element.html).toContain("[redacted]");
  }
  // Nowhere in the saved files, in any spelling: session.json, words.json, session.md.
  const forbidden = [email, encodeURIComponent(email), phone, encodeURIComponent(phone), "612 345 678"];
  for (const file of readdirSync(folder)) {
    const bytes = readFileSync(path.join(folder, file));
    for (const text of forbidden) expect(bytes.includes(Buffer.from(text, "utf8")), `"${text}" found in ${file}`).toBe(false);
  }
});
