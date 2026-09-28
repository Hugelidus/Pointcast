/**
 * What the pointing gesture is called on the user's keyboard. Chrome maps Alt to Option on macOS,
 * so the gesture is the same (event.altKey), but a Mac keyboard labels the key ⌥ / Option: the UI
 * names it the way the user sees it.
 */

interface NavigatorLike {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/**
 * True on macOS. userAgentData (Chromium, also in extension pages) says "macOS"; navigator.platform
 * ("MacIntel", deprecated but still filled in) and the user agent are the fallbacks.
 */
export function isMac(nav: NavigatorLike | undefined = globalThis.navigator as NavigatorLike | undefined): boolean {
  if (nav === undefined) return false;
  const fromHints = nav.userAgentData?.platform;
  if (fromHints) return fromHints === "macOS";
  return /^Mac/i.test(nav.platform ?? "") || /Macintosh|Mac OS X/.test(nav.userAgent ?? "");
}

/** "Alt+click", or "⌥ Option+click" on macOS. */
export function pointGestureName(mac: boolean): string {
  return mac ? "⌥ Option+click" : "Alt+click";
}
