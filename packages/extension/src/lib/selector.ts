import { DEFAULT_SENSITIVE_ATTRIBUTE, DEFAULT_SOURCE_ATTRIBUTES } from "@pointcast/core";
import { isShadowRoot } from "./dom";
import { cssModulePrefix, isGeneratedId, isSemanticClass } from "./noise";
import { isSensitive, type SensitivityOptions } from "./sensitive";
import { svgIdAttribute } from "./svg";
import { redactUrl } from "./url";

/** Attributes teams add precisely so that tests can find elements: the most stable anchors. */
const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy"];

/** Longer attribute values (sentences in aria-label) make brittle, unreadable selectors. */
const MAX_ATTRIBUTE_VALUE = 80;

export interface SelectorResult {
  selector: string;
  /** True when the selector matched exactly this element, and nothing else, at build time. */
  unique: boolean;
}

export interface SelectorOptions extends SensitivityOptions {
  sourceAttributes: readonly string[];
  /**
   * Maximum number of ancestor levels in the selector. Past it the selector is returned as is
   * with `unique: false`: a 15-level nth-of-type chain would be unique but useless.
   */
  maxDepth: number;
}

const DEFAULT_SELECTOR_OPTIONS: SelectorOptions = {
  sourceAttributes: DEFAULT_SOURCE_ATTRIBUTES,
  sensitiveAttribute: DEFAULT_SENSITIVE_ATTRIBUTE,
  maxDepth: 10,
};

/** A CSS string literal; CSS.escape is for identifiers, not for quoted attribute values. */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ").replace(/\r/g, "\\d ")}"`;
}

function attributeToken(tag: string, name: string, value: string): string {
  return `${tag}[${CSS.escape(name)}=${cssString(value)}]`;
}

/**
 * Relative same-site links without query strings: stable across environments and secret-free.
 * PRIVACY (D8): the selector is stored verbatim, so an href that redactUrl would change (a token
 * in the fragment or the path) must not become a selector token; sanitizeHtml redacts the same
 * href in the html, and the selector must not undo that.
 */
function isStableHref(href: string): boolean {
  if (href === "" || href.startsWith("#") || href.includes("?")) return false;
  if (redactUrl(href) !== href) return false;
  return !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

/**
 * Candidate tokens for one element, most stable first (D3 priority order).
 * Each token is a compound selector that matches the element on its own.
 */
function candidateTokens(el: Element, options: SelectorOptions): string[] {
  const tag = CSS.escape(el.localName);
  const tokens: string[] = [];

  // 1. Test and source attributes: written by developers for machines to find the element.
  for (const name of [...TEST_ATTRIBUTES, ...options.sourceAttributes]) {
    const value = el.getAttribute(name);
    if (value) tokens.push(attributeToken("", name, value));
  }

  // 2. id, unless the framework generated it.
  const id = el.getAttribute("id");
  if (id !== null && !isGeneratedId(id)) tokens.push(`#${CSS.escape(id)}`);

  // 3. Semantic attributes.
  // PRIVACY (D8): aria-label is otherwise a fine D3 token (a stable, human-chosen name), but a
  // sensitive element's accessible name sometimes mirrors its value; unlike id/name/class this
  // is free text, so it must not survive into the selector we keep for a sensitive element.
  const sensitiveAriaLabel = isSensitive(el, options);
  const semantic: [string, string | null][] = [
    ["name", el.getAttribute("name")],
    ["aria-label", sensitiveAriaLabel ? null : el.getAttribute("aria-label")],
    ["role", el.getAttribute("role")],
    ["type", el.localName === "input" ? el.getAttribute("type") : null],
    ["for", el.getAttribute("for")],
    ["href", el.localName === "a" ? el.getAttribute("href") : null],
  ];
  // An SVG item's identifier (svg.ts), the way the app itself finds it: `g[data-id="limites"]`.
  const item = sensitiveAriaLabel ? undefined : svgIdAttribute(el);
  if (item !== undefined) semantic.push([item.name, item.value]);
  for (const [name, value] of semantic) {
    if (!value || value.length > MAX_ATTRIBUTE_VALUE) continue;
    if ((name === "name" || name === "for") && isGeneratedId(value)) continue;
    if (name === "href" && !isStableHref(value)) continue;
    tokens.push(attributeToken(tag, name, value));
  }

  // 4. Classes a human chose; CSS-module classes by their stable prefix only.
  for (const cls of Array.from(el.classList)) {
    const prefix = cssModulePrefix(cls);
    if (prefix !== undefined) tokens.push(`${tag}[class*=${cssString(prefix)}]`);
    else if (isSemanticClass(cls)) tokens.push(`${tag}.${CSS.escape(cls)}`);
  }

  // 5. The bare tag; nth-of-type is added by the caller when even this is ambiguous.
  tokens.push(tag);
  return tokens;
}

function matchesOnly(root: ParentNode, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false; // defensive: a malformed token must not break capture
  }
}

function siblingsMatching(el: Element, token: string): number {
  const parent = el.parentElement;
  if (parent === null) return 1;
  return Array.from(parent.children).filter((child) => child.matches(token)).length;
}

function nthOfType(el: Element): string {
  let index = 1;
  for (let sibling = el.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
    if (sibling.localName === el.localName) index++;
  }
  return `${CSS.escape(el.localName)}:nth-of-type(${index})`;
}

/**
 * Builds the shortest stable CSS selector for `el` (D3): walk up from the element, trying the
 * most stable token at each level, and stop as soon as the selector matches exactly `el`.
 * When a level cannot be made unique by itself, it keeps its best sibling-unique token (or
 * nth-of-type) and the walk continues to the parent, joining levels with " > ".
 */
export function buildSelector(el: Element, options: Partial<SelectorOptions> = {}): SelectorResult {
  const settings = { ...DEFAULT_SELECTOR_OPTIONS, ...options };
  // Inside a shadow tree the selector is relative to its shadow root: the walk below stops there
  // (parentElement is null) and document.querySelectorAll cannot see inside it anyway.
  const root = el.getRootNode() as unknown as ParentNode;
  const parts: string[] = [];

  for (let current: Element | null = el; current !== null && parts.length < settings.maxDepth; current = current.parentElement) {
    const tokens = candidateTokens(current, settings);
    for (const token of tokens) {
      const selector = [token, ...parts].join(" > ");
      if (matchesOnly(root, selector, el)) return { selector, unique: true };
    }
    const levelToken = tokens.find((token) => siblingsMatching(current as Element, token) === 1) ?? nthOfType(current);
    parts.unshift(levelToken);
    const selector = parts.join(" > ");
    if (matchesOnly(root, selector, el)) return { selector, unique: true };
  }

  const selector = parts.join(" > ");
  return { selector, unique: matchesOnly(root, selector, el) };
}

/**
 * Selector for an element that may sit inside open shadow roots: the host's selector, then
 * " >>> ", then the selector inside that shadow root (the piercing notation Playwright and
 * WebdriverIO use). Best-effort: such a string is not valid for document.querySelector, so it is
 * never reported as unique.
 */
export function buildComposedSelector(el: Element, options: Partial<SelectorOptions> = {}): SelectorResult {
  const inner = buildSelector(el, options);
  const root = el.getRootNode();
  if (!isShadowRoot(root)) return inner;
  const host = buildComposedSelector(root.host, options);
  return { selector: `${host.selector} >>> ${inner.selector}`, unique: false };
}
