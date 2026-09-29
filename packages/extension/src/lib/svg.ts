/**
 * Pointing inside inline SVG (D7 note 2026-09-29). A chart or map drawn in SVG has its content
 * inside the drawing: a bar, a point, a star. An icon's SVG is part of the button or link that
 * holds it. So a click inside an <svg> lands on the SVG element that is content, when there is
 * one, and otherwise on the HTML element around the drawing, as it always did.
 */
import { isGeneratedId } from "./noise";
import { isSensitiveSelf, type SensitivityOptions } from "./sensitive";
import { collapseWhitespace } from "./text";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** An element of an SVG drawing (not an HTML element inside one of its <foreignObject>s). */
export function isSvgElement(el: Element): boolean {
  return el.namespaceURI === SVG_NAMESPACE;
}

/** An SVG element's own <title> child, which names it (its accessible name without aria-label). */
function titleChild(el: Element): Element | undefined {
  if (!isSvgElement(el)) return undefined;
  return Array.from(el.children).find((child) => child.localName === "title" && isSvgElement(child));
}

/** Whether an SVG element has a <title> child with some text (a name, whatever it says). */
export function hasSvgTitle(el: Element): boolean {
  return collapseWhitespace(titleChild(el)?.textContent ?? "") !== "";
}

/**
 * The text of an SVG element's own <title> child ("" when none). Callers check that `el` is not
 * sensitive (D8), as they do before reading its aria-label; a <title> marked sensitive itself is
 * never read.
 */
export function svgTitle(el: Element, options: SensitivityOptions): string {
  const title = titleChild(el);
  if (title === undefined || isSensitiveSelf(title, options)) return "";
  return collapseWhitespace(title.textContent ?? "");
}

/**
 * Data attributes that hold an identifier by convention: what an app puts on each item of a
 * drawing (a star, a node, a bar) to find it again, `closest("[data-id]")` on a click. An SVG
 * element with one is an item of the drawing, so it is content, and the value is a grep key
 * (D7 note 2026-09-29). A small set of names that mean "which one", never a free-text one:
 * `data-value`, `data-label` or `data-title` may hold what the drawing shows or a figure, so they
 * stay out, as every attribute outside an allowlist does (D8).
 */
export const SVG_ID_ATTRIBUTES: readonly string[] = ["data-id", "data-key", "data-node", "data-node-id", "data-name", "data-slug"];

/** The first identifier data attribute of an SVG element, with its value ("" values ignored). */
export function svgIdAttribute(el: Element): { name: string; value: string } | undefined {
  if (!isSvgElement(el)) return undefined;
  for (const name of SVG_ID_ATTRIBUTES) {
    const value = el.getAttribute(name)?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

/** Attributes written so that tests find the element (D3), the same allowlist as sanitize.ts. */
const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy"];

/** An icon is at most this big on screen (px, both sides); a chart or map is bigger. */
const MAX_ICON_SIZE = 32;

/** HTML elements that own an icon: pointing at the icon means pointing at them. */
const ICON_OWNERS = "button, a[href], label, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=option]";

/** Roles that say "nothing to see here". */
const NO_ROLE = new Set(["presentation", "none"]);

/** The outermost <svg> of the drawing `el` belongs to (an <svg> nested in another is part of it). */
function outermostSvg(el: Element): Element | null {
  let svg = el.closest("svg");
  for (let outer = svg?.parentElement?.closest("svg") ?? null; outer !== null; outer = outer.parentElement?.closest("svg") ?? null) {
    svg = outer;
  }
  return svg;
}

/**
 * A decorative drawing: hidden from assistive technology, inside an element that owns it as its
 * icon (a button, a link…), or icon-sized. Its shapes are never pointed at one by one.
 */
function isDecorative(svg: Element): boolean {
  if (svg.getAttribute("aria-hidden") === "true") return true;
  if (svg.parentElement?.closest(ICON_OWNERS)) return true;
  const { width, height } = svg.getBoundingClientRect();
  // No layout (width and height 0, as in a test DOM) says nothing about the size.
  return width > 0 && height > 0 && width <= MAX_ICON_SIZE && height <= MAX_ICON_SIZE;
}

/** `cursor: pointer` set on this element, not inherited from its parent. */
function ownPointerCursor(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (view === null) return false;
  if (view.getComputedStyle(el).cursor !== "pointer") return false;
  return el.parentElement === null || view.getComputedStyle(el.parentElement).cursor !== "pointer";
}

/**
 * An SVG element the author gave something of its own that makes it content: an accessible name
 * (aria-label, aria-labelledby, a <title> child), a role, a test attribute, an identifier data
 * attribute (`data-id`…, SVG_ID_ATTRIBUTES), a stable id, a way to
 * interact with it (a link, tabindex, an onclick attribute, its own pointer cursor), or visible
 * text (a <text> label). A shape with none of these is drawing, not content.
 */
function isSvgContent(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (collapseWhitespace(el.getAttribute("aria-label") ?? "") !== "") return true;
  if (el.hasAttribute("aria-labelledby") || hasSvgTitle(el)) return true;
  const role = el.getAttribute("role");
  if (role !== null && role !== "" && !NO_ROLE.has(role)) return true;
  if (TEST_ATTRIBUTES.some((name) => el.hasAttribute(name)) || svgIdAttribute(el) !== undefined) return true;
  const id = el.getAttribute("id");
  if (id !== null && id !== "" && !isGeneratedId(id)) return true;
  if (el.hasAttribute("tabindex") || el.hasAttribute("onclick")) return true;
  if (el.localName === "a" && (el.hasAttribute("href") || el.hasAttribute("xlink:href"))) return true;
  if (el.localName === "text" && collapseWhitespace(el.textContent ?? "") !== "") return true;
  return ownPointerCursor(el);
}

/**
 * What a click on `el` points at. Outside SVG, `el` itself. Inside a drawing that is not
 * decorative, the nearest SVG element that is content, from `el` up to (not including) the
 * outermost <svg>. Otherwise the HTML element around the drawing, as before: a shape that is
 * only drawing, or an icon, says less than its owner, and a wrong shape is worse than none.
 */
export function pointedElement(el: Element): Element {
  if (!isSvgElement(el)) return el;
  const svg = outermostSvg(el);
  if (svg === null) return el; // an SVG element outside any <svg> (detached markup)
  const around = svg.parentElement ?? svg;
  if (isDecorative(svg)) return around;
  // <defs>, <clipPath>… are never rendered where they are written; a click never lands in them,
  // but a <use> can: it is the <use> that was clicked, and it is checked as any other element.
  for (let current: Element | null = el; current !== null && current !== svg; current = current.parentElement) {
    if (isSvgContent(current)) return current;
  }
  return around;
}
