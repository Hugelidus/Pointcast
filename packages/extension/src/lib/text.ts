import { UI_ATTRIBUTE } from "@pointcast/core";
import { composedParent } from "./dom";
import { isSensitiveSelf, type SensitivityOptions } from "./sensitive";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Elements whose content is never read as text: code, invisible markup, icons, and form
 * controls. A textarea's child text is its (default) value and a select's options reveal the
 * chosen value, so reading them would leak form data (D8). An SVG element's <title> and <desc>
 * are its name and description, never shown on the page: they are read as its label
 * (describe.ts), not as its text. The text of a shape inside an <svg> is in <text> elements.
 */
const OPAQUE_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "textarea", "select", "datalist", "input", "iframe", "object",
  "title", "desc",
]);

/** Form controls whose content, or whose descendants' content, is the user's value (D8). */
const FORM_VALUE_TAGS = new Set(["textarea", "select", "datalist", "input"]);

/**
 * A contenteditable editing host: how rich-text editors (Lexical, ProseMirror, TipTap, Slate,
 * Quill) and most chat or comment composers are built. What is inside is what the user typed,
 * so it is a form value just like a textarea's text (D8). Any value but "false" makes it
 * editable ("", "true", "plaintext-only"), and when in doubt, not reading it is the safe side.
 */
export function isEditingHost(el: Element): boolean {
  const value = el.getAttribute("contenteditable");
  return value !== null && value.trim().toLowerCase() !== "false";
}

/**
 * True for a form control and for anything inside one: an <option> of a listbox (clicks land
 * on the option, and its text is the chosen value), or a paragraph inside a rich-text editor.
 * Checking only the element itself would miss these, because the clicked element is the root.
 */
export function isInsideFormValue(el: Element): boolean {
  for (let current: Element | null = el; current !== null; current = composedParent(current)) {
    if (FORM_VALUE_TAGS.has(current.localName) || isEditingHost(current)) return true;
  }
  return false;
}

/** Inline elements do not separate words unless layout sets them apart (laidOutApart); every other boundary does. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts to at most `max` characters, marking the cut with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** An element that is not rendered, so its text is not "visible". */
export function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  // checkVisibility (Chrome 105+) accounts for stylesheets; test DOMs without layout lack it.
  if (typeof el.checkVisibility !== "function" || el.checkVisibility()) return false;
  // A `display: contents` element has no box, so checkVisibility() is false although its
  // children render: SvelteKit wraps every app in one, which hid every selection on the page.
  // Such an element is exactly as visible as its parent.
  if (el.ownerDocument.defaultView?.getComputedStyle(el).display === "contents") {
    return el.parentElement !== null && isHidden(el.parentElement);
  }
  return true;
}

/**
 * True for elements whose subtree must never contribute text. pointcast's own UI (REC badge,
 * highlight flash) is included: a selection or container that spans it must not describe it.
 */
export function isTextOpaque(el: Element, options: SensitivityOptions): boolean {
  return (
    OPAQUE_TAGS.has(el.localName) ||
    isEditingHost(el) ||
    el.hasAttribute(UI_ATTRIBUTE) ||
    isSensitiveSelf(el, options) ||
    isHidden(el)
  );
}

/** The computed `display` of an element, or "" where there is no layout (a detached node). */
function displayOf(el: Element): string {
  const view = el.ownerDocument.defaultView;
  return view ? view.getComputedStyle(el).display : "";
}

/**
 * Whether two adjacent sibling elements are laid out apart on screen, so their texts need a space
 * between them: `<span>Sem 2</span><span>26 oct</span>` as flex items reads "Sem 2 26 oct", but
 * `<span>$</span><span>45</span>` in a line of text still reads "$45".
 */
function laidOutApart(parent: Element, previous: Element, next: Element): boolean {
  // Flex and grid items are blockified whatever their own display says.
  if (/^(inline-)?(flex|grid)$/.test(displayOf(parent))) return true;
  // No layout (""): keep them together, as before; `contents` flows like inline.
  const flows = (display: string): boolean => display === "" || display === "inline" || display === "contents";
  return !flows(displayOf(previous)) || !flows(displayOf(next));
}

/**
 * Visible text of `root`, whitespace-collapsed and cut to `max` characters.
 * Walks the DOM instead of using innerText so it can skip sensitive subtrees and form
 * controls, and stop early on huge containers. `except`: a descendant whose text is left out
 * (a badge's own «3», when reading the item it sits in); the words around it stay apart.
 */
export function visibleText(root: Element, options: SensitivityOptions, max: number, except?: Element): string {
  const pieces: string[] = [];
  let length = 0;

  const visit = (node: Node): void => {
    if (length > max) return;
    if (node.nodeType === TEXT_NODE) {
      const piece = (node as Text).data.replace(/\s+/g, " ");
      pieces.push(piece);
      length += piece.length;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const el = node as Element;
    if (el !== root && isTextOpaque(el, options)) return;
    if (el === except) {
      pieces.push(" ");
      return;
    }
    const separated = !INLINE_TAGS.has(el.localName);
    if (separated) pieces.push(" ");
    let previous: Element | undefined;
    for (const child of Array.from(el.childNodes)) {
      if (previous !== undefined && child.nodeType === ELEMENT_NODE && laidOutApart(el, previous, child as Element)) {
        pieces.push(" ");
      }
      visit(child);
      previous = child.nodeType === ELEMENT_NODE ? (child as Element) : undefined;
    }
    if (separated) pieces.push(" ");
  };

  // isHidden(root) matters here even though describeElement's top-level call never needs it (a
  // real click/selection target cannot itself be hidden): sanitizeHtml calls visibleText on each
  // *child* it summarizes, and that child was never interacted with, so its own hidden/off-screen
  // content (a common place to stash secrets, e.g. an autofill honeypot clone) must not surface
  // just because it happens to be the root of this particular call (PRIVACY, D8).
  if (OPAQUE_TAGS.has(root.localName) || isInsideFormValue(root) || isSensitiveSelf(root, options) || isHidden(root)) {
    return "";
  }
  visit(root);
  return truncate(collapseWhitespace(pieces.join("")), max);
}
