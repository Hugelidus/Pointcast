import { UI_ATTRIBUTE } from "@pointcast/core";

/** Long enough to notice while talking, short enough not to hide the app's own reaction. */
export const FLASH_MS = 400;

/**
 * A double ring, brand violet inside white, with a faint violet fill. Violet so a capture never
 * reads as an error (red is the REC dot and failures); the white ring keeps it visible on a red
 * or dark element, where a single violet outline would disappear. The white is a box-shadow
 * under the outline: white 0–1 px, violet 1–3 px, white 3–4 px outside the element.
 */
const FLASH_STYLE: Record<string, string> = {
  position: "fixed",
  "box-sizing": "border-box",
  margin: "0",
  padding: "0",
  border: "0",
  outline: "2px solid #7c3aed",
  "outline-offset": "1px",
  "box-shadow": "0 0 0 4px #fff",
  "border-radius": "3px",
  background: "rgba(124, 58, 237, 0.12)",
  "pointer-events": "none",
  "z-index": "2147483647",
};

/** Undo: a grey dashed outline, so "removed" never reads as "captured" (violet). */
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
  // so it is driven by a timer rather than by the animation's finish event. With reduced motion
  // the ring simply appears and disappears.
  if (typeof overlay.animate === "function" && !prefersReducedMotion(doc)) {
    overlay.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: durationMs, fill: "forwards" });
  }
  setTimeout(() => overlay.remove(), durationMs);
}

function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
