/**
 * Sensitivity rules (D8). Kept apart from sanitize.ts because text extraction needs them too,
 * and sanitize.ts in turn needs text extraction.
 */
import { composedClosest } from "./dom";

/** autocomplete tokens that announce secrets or payment data. */
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-.+)$/;

export interface SensitivityOptions {
  sensitiveAttribute: string;
}

/** True when this element itself is a secret field or carries the marker attribute. */
export function isSensitiveSelf(el: Element, options: SensitivityOptions): boolean {
  if (el.hasAttribute(options.sensitiveAttribute)) return true;
  if (el.localName === "input" && el.getAttribute("type")?.toLowerCase() === "password") return true;
  // autocomplete may hold several tokens ("section-billing cc-number"), so check each one.
  const autocomplete = el.getAttribute("autocomplete");
  if (autocomplete === null) return false;
  return autocomplete.toLowerCase().split(/\s+/).some((token) => SENSITIVE_AUTOCOMPLETE.test(token));
}

/**
 * True when the element is sensitive or sits inside a subtree marked sensitive.
 * Only the marker attribute propagates to descendants: a password input has no children.
 * The marker also reaches into open shadow roots: a web component inside a marked subtree is
 * as sensitive as a plain element there.
 */
export function isSensitive(el: Element, options: SensitivityOptions): boolean {
  if (isSensitiveSelf(el, options)) return true;
  return composedClosest(el, `[${CSS.escape(options.sensitiveAttribute)}]`) !== null;
}
