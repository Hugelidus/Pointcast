import { UI_ATTRIBUTE } from "@pointcast/core";
import { composedParent } from "./dom";
import { isSensitiveSelf, type SensitivityOptions } from "./sensitive";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Elements whose content is never read as text: code, invisible markup, icons, and form
 * controls. A textarea's child text is its (default) value and a select's options reveal the
 * chosen value, so reading them would leak form data (D8).
 */
const OPAQUE_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "textarea", "select", "datalist", "input", "iframe", "object",
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

/** Inline elements do not separate words; every other boundary does ("<td>a</td><td>b</td>" → "a b"). */
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

function hasWordAtEdge(
  node: Node,
  fromStart: boolean,
  options: SensitivityOptions,
  budget = { remaining: 128 },
): boolean {
  // This is only a boundary hint; do not scan a large subtree just to add a separator.
  if (budget.remaining-- <= 0) return false;
  if (node.nodeType === TEXT_NODE) {
    const text = (node as Text).data;
    const trimmed = fromStart ? text.trimStart() : text.trimEnd();
    const character = fromStart ? Array.from(trimmed)[0] : Array.from(trimmed).at(-1);
    return character !== undefined && /[\p{L}\p{N}]/u.test(character);
  }
  if (node.nodeType !== ELEMENT_NODE) return false;
  const el = node as Element;
  if (isTextOpaque(el, options)) return false;
  const children = Array.from(el.childNodes);
  if (!fromStart) children.reverse();
  return children.some((child) => hasWordAtEdge(child, fromStart, options, budget));
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
    const children = Array.from(el.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const previous = children[i - 1];
      if (
        child?.nodeType === ELEMENT_NODE &&
        previous?.nodeType === ELEMENT_NODE &&
        INLINE_TAGS.has((child as Element).localName) &&
        INLINE_TAGS.has((previous as Element).localName) &&
        hasWordAtEdge(previous, false, options) &&
        hasWordAtEdge(child, true, options)
      ) {
        pieces.push(" ");
      }
      if (child !== undefined) visit(child);
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
