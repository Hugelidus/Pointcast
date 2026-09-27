import { browser, type Browser } from "wxt/browser";
import { sendToTab, type TabCapture } from "../messages";
import { isCapturableUrl } from "../sites";
import { enabledSites } from "./site-scripts";

/**
 * Makes sure captured tabs (local dev hosts and the sites the user enabled, D8) have a live
 * content script (D6, note 2026-09-26).
 *
 * Chrome injects manifest content scripts only into pages loaded AFTER the extension was
 * installed, updated, reloaded or re-enabled. A page that was already open has either no
 * content script or an orphaned copy from the previous instance, which can no longer reach the
 * extension: it never hears that a recording started, so Alt+click runs the app's action and
 * the session ends with no events. So the service worker pings each local tab and injects the
 * content script where nobody answers: when the extension is installed or reloaded, before a
 * recording is reported as started, and when the popup opens on a tab.
 *
 * Injecting a copy also retires an orphaned one: every WXT content script announces itself
 * with a DOM event when it starts, and older copies of the same script stop on it (content.ts).
 */

/**
 * A ping answers in milliseconds and an injection in well under a second. This only catches a
 * tab that cannot answer (e.g. paused in the debugger), so it cannot hold up a recording.
 */
export const ATTACH_TIMEOUT_MS = 2_000;

export interface TabInfo {
  id: number;
  /** Only known for tabs the extension has host permissions (or activeTab) for. */
  url?: string | undefined;
}

/** The two browser operations attaching needs; injected so the decision logic is unit-tested. */
export interface TabAccess {
  /** Resolves when a live content script answers in the tab's top frame; rejects otherwise. */
  ping(tabId: number): Promise<void>;
  /** Runs the content script in the tab's top frame; rejects when the page cannot be scripted. */
  inject(tabId: number): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The tab did not answer within ${ms / 1000} s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Attaches pointcast to one tab and says whether it is captured. Never rejects.
 * - Neither a local dev host nor an enabled site (`sites`): left alone (D8).
 * - A live content script answers the ping: nothing to do. This is the guard against a second
 *   copy in the same extension instance.
 * - Nobody answers ("Receiving end does not exist"): inject the content script, then ping
 *   again, so "attached" always means a script that really answers.
 * - Injection fails (Chrome error page, a tab closed meanwhile) or times out: "unavailable".
 */
export async function attachTab(
  tab: TabInfo,
  access: TabAccess,
  sites: readonly string[] = [],
  timeoutMs = ATTACH_TIMEOUT_MS,
): Promise<TabCapture> {
  if (!isCapturableUrl(tab.url, sites)) return { status: "not-local" };
  const attach = async (): Promise<TabCapture> => {
    const alive = await access.ping(tab.id).then(
      () => true,
      () => false,
    );
    if (!alive) {
      await access.inject(tab.id);
      await access.ping(tab.id);
    }
    return { status: "attached" };
  };
  try {
    return await withTimeout(attach(), timeoutMs);
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}

export interface TabAttacher {
  /** attachTab, but a tab already being attached gets the pending result instead of a new attach. */
  attach(tab: TabInfo, sites?: readonly string[]): Promise<TabCapture>;
}

/**
 * Without this, two callers at once (the install event and a Record press, or the popup)
 * would both ping before either injection finished, and both would inject. Only in-flight
 * calls are kept, so nothing here outlives the calls (D6).
 */
export function createTabAttacher(access: TabAccess, timeoutMs = ATTACH_TIMEOUT_MS): TabAttacher {
  const pending = new Map<number, Promise<TabCapture>>();
  return {
    attach(tab, sites = []) {
      const current = pending.get(tab.id);
      if (current) return current;
      const result = attachTab(tab, access, sites, timeoutMs).finally(() => pending.delete(tab.id));
      pending.set(tab.id, result);
      return result;
    },
  };
}

const chromeTabs: TabAccess = {
  async ping(tabId) {
    const answer = await sendToTab(tabId, { to: "content", type: "ping" });
    if (!answer?.alive) throw new Error("The content script did not answer.");
  },
  async inject(tabId) {
    // The very files the manifest lists for entrypoints/framework.content.ts and content.ts. WXT
    // types these paths from the build's entrypoints, so renaming a content script breaks the
    // typecheck, not the injection. Top frame only, each in its manifest world. The MAIN-world
    // bridge first: without it, events on this page would lack their component name and file
    // until a reload. Injecting it twice is harmless (installComponentBridge is idempotent).
    await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["/content-scripts/framework.js"] });
    await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
  },
};

const attacher = createTabAttacher(chromeTabs);

/** Attaches pointcast to one tab (the popup's active tab). Never rejects. */
export async function attachToTab(tabId: number): Promise<TabCapture> {
  let tab: Browser.tabs.Tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
  return attacher.attach({ id: tabId, url: tab.url }, await enabledSites().catch(() => []));
}

/**
 * Attaches pointcast to every open tab on a local dev host or an enabled site, in parallel.
 * Never rejects: a tab that cannot be attached is logged and skipped, it never fails a
 * recording. Other tabs are never touched (D8); discarded tabs have no page to script and get
 * the manifest (or registered) script when they load again.
 */
export async function attachToOpenTabs(): Promise<TabCapture[]> {
  let tabs: Browser.tabs.Tab[];
  try {
    tabs = await browser.tabs.query({});
  } catch (error) {
    console.warn("[pointcast] could not list the open tabs", error);
    return [];
  }
  const sites = await enabledSites().catch(() => []);
  const captured = tabs.filter((tab) => tab.id !== undefined && !tab.discarded && isCapturableUrl(tab.url, sites));
  return Promise.all(
    captured.map(async (tab) => {
      const result = await attacher.attach({ id: tab.id as number, url: tab.url }, sites);
      if (result.status === "unavailable") console.warn(`[pointcast] not capturing ${tab.url}: ${result.error}`);
      return result;
    }),
  );
}
