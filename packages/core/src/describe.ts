import { projectRelativePath } from "./paths";
import type { CapturedEvent, ElementInfo, SourceRef } from "./schema";

/** mm:ss from ms relative to t0. Minutes keep growing past 59 (a 61-minute session is 61:05). */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Drop the fragment unless it is a client-side route ("#/orders", "#!/orders"), which
 * hash-routed SPAs use instead of the path. "#top" is only a scroll position.
 */
function withoutScrollFragment(url: string): string {
  const hash = url.indexOf("#");
  if (hash < 0) return url;
  return /^#!?\//.test(url.slice(hash)) ? url : url.slice(0, hash);
}

/**
 * Short page label for URL separators: path + search (+ route fragment), without origin.
 * All captured pages are on local dev hosts, so the origin rarely carries information.
 * Plain string handling on purpose: core has no DOM/Node types, so no URL class.
 */
export function urlLabel(url: string): string {
  const rest = withoutScrollFragment(url).replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "");
  return rest === "" ? "/" : rest;
}

/**
 * Identity of an element across events, for de-duplication in markers and the appendix.
 * The selector alone is not enough: "#main > button" on /orders and on /users are different
 * elements, so the page (origin + path + search + route fragment) is part of the key.
 */
export function elementKey(event: CapturedEvent): string {
  return `${event.element.selector}\u0000${withoutScrollFragment(event.url)}`;
}

/** Visible text, falling back to the label (icon buttons, redacted sensitive elements). */
export function elementText(element: ElementInfo): string {
  return element.text !== "" ? element.text : (element.label ?? "");
}

/**
 * A value rather than words: non-empty, with no run of two or more letters ("3", "12", "+5",
 * "99+", "$4", "•", "✓"). Capture looks for the item such a value belongs to
 * (ElementInfo.itemLabel), and the resolver looks the value up through that item, not alone.
 */
export function isShortValue(text: string): boolean {
  return text.trim() !== "" && !/\p{L}{2}/u.test(text);
}

/** What the user pointed at: the selected text for selections, else the element's text. */
export function eventText(event: CapturedEvent): string {
  if (event.gesture === "select" && event.selection && event.selection.text !== "") {
    return event.selection.text;
  }
  return elementText(event.element);
}

/** "Toolbar.tsx:12" — compact form for inline markers; the appendix has the full path. */
export function shortSource(source: SourceRef): string {
  const base = source.file.split(/[\\/]/).pop() ?? source.file;
  return source.line === undefined ? base : `${base}:${source.line}`;
}

/**
 * "src/components/Toolbar.tsx:12:5". Normalizes the file to a project-relative path (D8):
 * defense in depth for a session recorded before capture normalized it, or one edited by hand.
 */
export function fullSource(source: SourceRef): string {
  let out = projectRelativePath(source.file);
  if (source.line !== undefined) out += `:${source.line}`;
  if (source.line !== undefined && source.column !== undefined) out += `:${source.column}`;
  return out;
}
