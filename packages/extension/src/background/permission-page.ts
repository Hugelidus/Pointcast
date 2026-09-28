import { browser } from "wxt/browser";

/**
 * The microphone permission page (entrypoints/permission). Chrome lets an extension ask for the
 * microphone only from a visible page of its own, never from the offscreen recorder (D6), so a
 * Record without a grant opens this page in a new tab; the popup's "Allow microphone" does too.
 */

/** Query parameter with the tab the user was in, for the page's "Back to my app" button. */
export const FROM_TAB_PARAM = "from";

/**
 * The page's URL. `fromTabId` is the tab the user recorded from: the page brings it back to the
 * front once the microphone is allowed, instead of leaving the user to find their app again.
 */
export function permissionPageUrl(fromTabId?: number): string {
  const url = browser.runtime.getURL("/permission.html");
  return fromTabId === undefined ? url : `${url}?${FROM_TAB_PARAM}=${fromTabId}`;
}

/** The `from` tab id in the page's own query string, if it is one. */
export function parseFromTab(search: string): number | undefined {
  const value = new URLSearchParams(search).get(FROM_TAB_PARAM);
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/** Opens the page next to the tab the user is in, remembering that tab. Never rejects. */
export async function openPermissionPage(): Promise<void> {
  let from: number | undefined;
  try {
    const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    from = active?.id;
  } catch {
    // Without it the page only loses its "Back to my app" button.
  }
  try {
    await browser.tabs.create({ url: permissionPageUrl(from) });
  } catch (error) {
    console.error("[pointcast] could not open the microphone permission page", error);
  }
}
