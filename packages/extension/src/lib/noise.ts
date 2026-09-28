/**
 * Heuristics that tell stable, human-chosen names apart from machine-generated noise (D3).
 * Both the selector builder and the HTML sanitizer use them: noise makes selectors
 * break on the next build and wastes the agent's tokens in the HTML.
 */

import { isUtilityClass } from "@pointcast/core";

/** Tailwind/UnoCSS utilities: core's rule (utility-classes.ts), shared with the spec's `find:` line. */
export { isUtilityClass };

/** Class names emitted by CSS-in-JS libraries and scoped-style compilers. */
const HASHED_CLASS = [
  /^css-[a-z0-9]+(-[\w-]+)?$/i, // emotion / MUI
  /^sc-[a-z0-9]+$/i, // styled-components component id
  /^svelte-[a-z0-9]+$/i,
  /^jsx-\d+$/, // styled-jsx
  /^ng-/, // Angular state classes (ng-valid, ng-touched, ng-star-inserted)
  /^_[a-z0-9]{5,}$/i, // Vite/webpack CSS-module fallback names like "_1x2y3"
];

/**
 * styled-components' second class (`kUgNyR`, `bdVaJa`): 5-8 letters, no separators, with at
 * least two capitals after the first letter. Real camelCase names (`navItem`) have one hump.
 */
const RANDOM_MIXED_CASE = /^[a-zA-Z]{5,8}$/;

/** CSS modules: `Toolbar_export__3xKz1` keeps its stable `Toolbar_export__` prefix. */
const CSS_MODULE_CLASS = /^([A-Za-z][A-Za-z0-9-]*_[A-Za-z0-9-]+__)[A-Za-z0-9_-]{3,}$/;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_DIGIT_RUN = /\d{4,}/;

export function isHashedClass(name: string): boolean {
  if (HASHED_CLASS.some((pattern) => pattern.test(name))) return true;
  if (RANDOM_MIXED_CASE.test(name) && (name.slice(1).match(/[A-Z]/g)?.length ?? 0) >= 2) return true;
  return LONG_DIGIT_RUN.test(name) || UUID.test(name);
}

/** Returns the stable prefix of a CSS-module class, or undefined when `name` is not one. */
export function cssModulePrefix(name: string): string | undefined {
  return CSS_MODULE_CLASS.exec(name)?.[1];
}

/** A class a human chose on purpose (`toolbar`, `delete-row`), usable as-is in a selector. */
export function isSemanticClass(name: string): boolean {
  return name.length > 0 && cssModulePrefix(name) === undefined && !isUtilityClass(name) && !isHashedClass(name);
}

/**
 * Ids generated at runtime change between renders or builds, so they must not anchor a selector:
 * React useId (`:r1:`, `«r1»`), Radix, Headless UI, MUI, long digit runs, UUIDs.
 */
export function isGeneratedId(id: string): boolean {
  if (id.trim() === "") return true;
  if (/[:«»]/.test(id)) return true;
  if (/^(radix|headlessui|mui|react-aria|rc-|ember|downshift)/i.test(id)) return true;
  return LONG_DIGIT_RUN.test(id) || UUID.test(id);
}
