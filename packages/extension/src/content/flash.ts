import { UI_ATTRIBUTE } from "@pointcast/core";

/** Long enough to notice while talking, short enough not to hide the app's own reaction. */
export const FLASH_MS = 400;

/** Outline + faint fill; the red matches the REC badge so both read as "pointcast". */
const FLASH_STYLE: Record<string, string> = {
  position: "fixed",
  "box-sizing": "border-box",
  margin: "0",
  padding: "0",
  border: "0",
  outline: "2px solid #ea4335",
  "outline-offset": "1px",
  "border-radius": "3px",
  background: "rgba(234, 67, 53, 0.12)",
  "pointer-events": "none",
  "z-index": "2147483647",
};

/** Undo: a grey dashed outline, so "removed" never reads as "captured" (red). */
const UNDONE_STYLE: Record<string, string> = {
  outline: "2px dashed #5f6368",
  background: "rgba(95, 99, 104, 0.15)",
};

/**
 * Briefly outlines `target` so the user sees what was captured (plan step 5), or, with
 * `undone`, that its gesture was just removed by Undo.
 *
 * Why an overlay instead of styling `target` itself:
 * - touching the app's element could trigger its own style observers or transitions, and
 *   the element would have to carry UI_ATTRIBUTE, which makes capture ignore it;
 * - the overlay carries UI_ATTRIBUTE and pointer-events: none, so it is never a click or
 *   selection target and capture never describes it.
 * Every property is inline with !important: inline important declarations beat any page
 * stylesheet, so a rule like `div { display: none !important }` cannot hide or restyle it.
 */
export function flashElement(target: Element, durationMs: number = FLASH_MS, undone = false): void {
  const doc = target.ownerDocument;
  const rect = target.getBoundingClientRect();
  const overlay = doc.createElement("div");
  overlay.setAttribute(UI_ATTRIBUTE, "flash");
  const style = { ...FLASH_STYLE, ...(undone ? UNDONE_STYLE : {}), top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` };
  for (const [property, value] of Object.entries(style)) overlay.style.setProperty(property, value, "important");
  // documentElement rather than body, like the REC indicator: some SPAs replace <body>.
  doc.documentElement.append(overlay);

  // Fading is cosmetic (jsdom has no Web Animations); removal is what must always happen,
  // so it is driven by a timer rather than by the animation's finish event.
  if (typeof overlay.animate === "function") {
    overlay.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: durationMs, fill: "forwards" });
  }
  setTimeout(() => overlay.remove(), durationMs);
}
