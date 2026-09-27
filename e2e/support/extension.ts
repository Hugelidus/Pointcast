import type { BrowserContext, Page, Worker } from "@playwright/test";

/**
 * Helpers for the extension's life cycle: reloading it like a developer does (chrome://extensions
 * reload button, or `wxt dev` rebuilding), and observing which copies of the content script
 * run in a page.
 */

function isExtensionWorker(worker: Worker, extensionId: string): boolean {
  return worker.url().startsWith(`chrome-extension://${extensionId}/`);
}

function extensionWorker(context: BrowserContext, extensionId: string): Worker {
  const worker = context.serviceWorkers().find((w) => isExtensionWorker(w, extensionId));
  if (!worker) throw new Error("the extension has no running service worker");
  return worker;
}

/**
 * Turns on developer mode, as anyone who loads pointcast unpacked has it. Without it Chrome
 * disables an unpacked extension instead of reloading it ("unsupportedDeveloperExtension").
 * The profile preference cannot be preset in the Preferences file (Chrome ignores it there),
 * so this uses the API behind chrome://extensions' own toggle.
 */
async function enableDeveloperMode(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions");
    await page.evaluate(() => {
      const api = (globalThis as unknown as { chrome: { developerPrivate: { updateProfileConfiguration(u: object): Promise<void> } } })
        .chrome.developerPrivate;
      return api.updateProfileConfiguration({ inDeveloperMode: true });
    });
  } finally {
    await page.close();
  }
}

/**
 * Reloads the extension (chrome.runtime.reload in its service worker, what the reload button of
 * chrome://extensions and `wxt dev` do) and waits for the new instance's worker. Pages already
 * open keep the OLD instance's content script, which is now cut off from the extension
 * (orphaned). Extension pages close with the old instance, so this returns a new popup.html.
 */
export async function reloadExtension(context: BrowserContext, extensionId: string): Promise<Page> {
  await enableDeveloperMode(context);
  const oldWorker = extensionWorker(context, extensionId);
  const newWorker = context.waitForEvent("serviceworker", {
    predicate: (w) => w !== oldWorker && isExtensionWorker(w, extensionId),
  });
  // The worker is torn down while evaluating, so this evaluation never gets an answer.
  oldWorker.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  await newWorker;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

/**
 * Opens a new page and returns it with its Chrome tab id, found as the one tab id that was not
 * there before. Works for pages whose URL the extension may not see (remote sites, file://).
 */
export async function newPageWithTabId(context: BrowserContext, extensionPage: Page): Promise<{ page: Page; tabId: number }> {
  const ids = () => extensionPage.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const before = new Set(await ids());
  const page = await context.newPage();
  const added = (await ids()).filter((id) => !before.has(id));
  const [tabId] = added;
  if (added.length !== 1 || tabId === undefined) throw new Error(`expected one new tab, found ${added.length}`);
  return { page, tabId };
}

/**
 * Turns the extension off and on again from chrome://extensions (chrome.management, the API
 * behind its toggle). Like a reload, this orphans the content scripts of open pages, but Chrome
 * does not fire runtime.onInstalled for it. Returns a new popup.html, as reloadExtension does.
 */
export async function disableAndEnableExtension(context: BrowserContext, extensionId: string): Promise<Page> {
  const oldWorker = extensionWorker(context, extensionId);
  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions");
    const setEnabled = (enabled: boolean) =>
      page.evaluate(
        ([id, on]) => {
          const api = (globalThis as unknown as { chrome: { management: { setEnabled(id: string, on: boolean): Promise<void> } } })
            .chrome.management;
          return api.setEnabled(id, on);
        },
        [extensionId, enabled] as const,
      );
    await setEnabled(false);
    const newWorker = context.waitForEvent("serviceworker", {
      predicate: (w) => w !== oldWorker && isExtensionWorker(w, extensionId),
    });
    await setEnabled(true);
    // The popup's first message to the service worker starts it, if Chrome has not already.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await newWorker;
    return popup;
  } finally {
    await page.close();
  }
}

/**
 * Sets the keyboard shortcut of one of the extension's commands, or removes it with "", as the
 * user does in chrome://extensions/shortcuts (this is the API behind that page). `keybinding`
 * uses that page's format, e.g. "Alt+Shift+P".
 */
export async function setCommandShortcut(
  context: BrowserContext,
  extensionId: string,
  commandName: string,
  keybinding: string,
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions/shortcuts");
    await page.evaluate(
      ([id, name, keys]) => {
        const api = (
          globalThis as unknown as {
            chrome: { developerPrivate: { updateExtensionCommand(update: object): Promise<void> } };
          }
        ).chrome.developerPrivate;
        return api.updateExtensionCommand({ extensionId: id, commandName: name, keybinding: keys });
      },
      [extensionId, commandName, keybinding] as const,
    );
  } finally {
    await page.close();
  }
}

/**
 * Counts content script starts from now on, in the page's main world. Every copy of a WXT
 * content script announces itself with a DOM event on `document` when it starts (that is how
 * older copies learn they must stop), and DOM events are visible to every world of the page.
 */
export async function countContentScriptStarts(page: Page, extensionId: string): Promise<() => Promise<number>> {
  const eventName = `${extensionId}:content:wxt:content-script-started`;
  await page.evaluate((name) => {
    const w = window as unknown as { __pointcastStarts?: number };
    w.__pointcastStarts = 0;
    document.addEventListener(name, () => {
      w.__pointcastStarts = (w.__pointcastStarts ?? 0) + 1;
    });
  }, eventName);
  return () => page.evaluate(() => (window as unknown as { __pointcastStarts?: number }).__pointcastStarts ?? 0);
}

/**
 * Number of isolated worlds the extension has in the page, through the DevTools protocol.
 * Informational: tells whether a reloaded extension's content script got a world of its own.
 */
export async function contentScriptWorlds(context: BrowserContext, page: Page, extensionId: string): Promise<number> {
  const cdp = await context.newCDPSession(page);
  try {
    let count = 0;
    cdp.on("Runtime.executionContextCreated", ({ context: c }) => {
      if (c.origin === `chrome-extension://${extensionId}`) count += 1;
    });
    await cdp.send("Runtime.enable");
    return count;
  } finally {
    await cdp.detach();
  }
}
