import { UI_ATTRIBUTE } from "@pointcast/core";
import { cssModulePrefix, isSemanticClass } from "./noise";
import { isSensitive, isSensitiveSelf, type SensitivityOptions } from "./sensitive";
import { collapseWhitespace, isEditingHost, isInsideFormValue, truncate, visibleText } from "./text";
import { isSvgElement, SVG_ID_ATTRIBUTES, svgTitle } from "./svg";
import { redactUrl } from "./url";

export { isSensitive } from "./sensitive";

export interface SanitizeOptions extends SensitivityOptions {
  sourceAttributes: readonly string[];
  /** Maximum length of the returned HTML (D5 capture budget, ~2000). */
  htmlBudget: number;
}

/** Placeholder for the content of sensitive elements. */
export const REDACTED_CONTENT = "[redacted]";

const MAX_CHILDREN = 5;
const MAX_TEXT = 60;
const MAX_ATTRIBUTE_VALUE = 120;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

/** Never worth a token in the agent's context. */
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template"]);

/** SVG elements whose text is a name or a description, not visible text. */
const SVG_TEXT_TAGS = new Set(["title", "desc"]);

/** Their content is a form value (textarea text, selected option): keep the tag, drop the inside. */
const EMPTIED_TAGS = new Set(["textarea", "select", "datalist"]);

/**
 * ALLOWLIST (D5, D8): an attribute not listed here never leaves the page, so anything a
 * framework or app adds in the future is excluded by default. `value`, `checked`,
 * `selected`, `style` and event handlers are therefore dropped without being named.
 */
const ALLOWED_ATTRIBUTES = new Set([
  "id", "name", "type", "role", "for", "href", "placeholder", "title", "alt",
  "data-testid", "data-test", "data-cy",
]);

/** aria-* is allowed except the attributes that mirror a control's current value or state. */
const ARIA_VALUE_ATTRIBUTE = /^aria-(value|checked|selected)/;

function isAllowedAttribute(el: Element, name: string, options: SanitizeOptions): boolean {
  if (ALLOWED_ATTRIBUTES.has(name) || options.sourceAttributes.includes(name)) return true;
  // An SVG item's identifier (`<g data-id="limites">`, svg.ts): the grep key of a star or a node.
  if (SVG_ID_ATTRIBUTES.includes(name) && isSvgElement(el)) return true;
  return name.startsWith("aria-") && !ARIA_VALUE_ATTRIBUTE.test(name);
}

/**
 * Otherwise-allowlisted attributes that real apps use to mirror a field's current value as free
 * text — a masked-value tooltip (`title`), an accessible name built from the value (`aria-label`),
 * an `alt`, or a `placeholder` that was swapped for the typed value. Redacting only an element's
 * *content* (D8) is not enough when its own opening tag can carry the same value; these never
 * survive on a sensitive element or one inside a sensitive subtree (D8), whatever `openTag` keeps
 * for everyone else.
 */
const SENSITIVE_TEXT_ATTRIBUTES = new Set(["title", "aria-label", "alt", "placeholder"]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Keeps human classes and CSS-module classes (grep keys for the agent), drops utility/hashed noise. */
function cleanClass(value: string): string {
  return value
    .split(/\s+/)
    .filter((cls) => cls !== "" && (isSemanticClass(cls) || cssModulePrefix(cls) !== undefined))
    .join(" ");
}

function openTag(el: Element, options: SanitizeOptions): string {
  // Ancestor-aware (isSensitive, not isSensitiveSelf): an element inside a data-sensitive
  // subtree must lose these attributes too, not only the subtree's own marked root.
  const sensitive = isSensitive(el, options);
  let tag = `<${el.localName}`;
  for (const attribute of Array.from(el.attributes)) {
    let value = attribute.value;
    if (attribute.name === "class") {
      value = cleanClass(value);
      if (value === "") continue;
    } else if (!isAllowedAttribute(el, attribute.name, options)) {
      continue;
    } else if (sensitive && (SENSITIVE_TEXT_ATTRIBUTES.has(attribute.name) || SVG_ID_ATTRIBUTES.includes(attribute.name))) {
      continue;
    }
    if (attribute.name === "href") value = redactUrl(value);
    tag += value === "" ? ` ${attribute.name}` : ` ${attribute.name}="${escapeAttribute(truncate(value, MAX_ATTRIBUTE_VALUE))}"`;
  }
  return `${tag}>`;
}

/**
 * An element with its content replaced by `inner`; void elements have no content or end tag.
 * An <svg> is always collapsed; an empty SVG shape closes itself (`<circle class="star"/>`), and
 * its geometry (d, cx, points…) is not in the attribute allowlist, so a path's data never is.
 */
function wrap(el: Element, inner: string, options: SanitizeOptions): string {
  if (el.localName === "svg") return "<svg/>";
  if (VOID_TAGS.has(el.localName)) return openTag(el, options);
  if (inner === "" && isSvgElement(el)) return `${openTag(el, options).slice(0, -1)}/>`;
  return `${openTag(el, options)}${inner}</${el.localName}>`;
}

/** A direct child: its tag plus a short summary of its text, never its own children. */
function renderChild(child: Element, options: SanitizeOptions): string {
  if (isSensitiveSelf(child, options)) return wrap(child, REDACTED_CONTENT, options);
  // A rich-text editor inside the described element holds what the user typed (text.ts).
  if (EMPTIED_TAGS.has(child.localName) || isEditingHost(child)) return wrap(child, "", options);
  const text = visibleText(child, options, MAX_TEXT);
  if (text === "" && isSvgElement(child)) {
    // An SVG <title> or <desc> names or describes its parent, and text.ts leaves it out of the
    // visible text: its own words are its summary. A shape with no text is summarized by its
    // <title>, which is what tells one bar or star from the next.
    const own = SVG_TEXT_TAGS.has(child.localName);
    const title = own ? collapseWhitespace(child.textContent ?? "") : svgTitle(child, options);
    if (title !== "") {
      const summary = escapeText(truncate(title, MAX_TEXT));
      return wrap(child, own ? summary : `<title>${summary}</title>`, options);
    }
  }
  return wrap(child, escapeText(text), options);
}

function renderRoot(el: Element, maxChildren: number, options: SanitizeOptions): string {
  if (isSensitive(el, options)) return wrap(el, REDACTED_CONTENT, options);
  // Also an <option> of a listbox or a paragraph inside an editor: the clicked element can sit
  // inside a form value without being a form control itself.
  if (EMPTIED_TAGS.has(el.localName) || isInsideFormValue(el)) return wrap(el, "", options);

  let inner = "";
  let shown = 0;
  let hidden = 0;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const raw = (node as Text).data;
      const text = collapseWhitespace(raw);
      if (text === "") continue; // indentation between tags
      // Keep one space where the source had one, so "type <code>" does not become "type<code>".
      const before = /^\s/.test(raw) ? " " : "";
      const after = /\s$/.test(raw) ? " " : "";
      inner += `${before}${escapeText(truncate(text, MAX_TEXT))}${after}`;
      continue;
    }
    if (node.nodeType !== 1) continue; // comments, processing instructions
    const child = node as Element;
    // pointcast's own UI (REC badge, highlight flash) sits at the end of <html>: never part of the app.
    if (SKIPPED_TAGS.has(child.localName) || child.hasAttribute(UI_ATTRIBUTE)) continue;
    if (shown < maxChildren) {
      inner += renderChild(child, options);
      shown++;
    } else {
      hidden++;
    }
  }
  if (hidden > 0) inner += `…(+${hidden})`;
  return wrap(el, inner.trim(), options);
}

/**
 * Sanitized, structurally trimmed outerHTML (D5): allowlisted attributes only, direct children
 * only (at most 5), texts cut at 60 characters, <svg> collapsed, form values and sensitive
 * content never included. Over budget, children are dropped one by one instead of cutting the
 * string, so the result is always well-formed.
 */
export function sanitizeHtml(el: Element, options: SanitizeOptions): string {
  for (let children = MAX_CHILDREN; children >= 0; children--) {
    const html = renderRoot(el, children, options);
    if (html.length <= options.htmlBudget) return html;
  }
  // Only a pathological open tag (dozens of long aria-* attributes) gets here.
  return VOID_TAGS.has(el.localName) ? `<${el.localName}>` : `<${el.localName}>…</${el.localName}>`;
}
