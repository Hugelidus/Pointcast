/**
 * Heuristics that tell stable, human-chosen names apart from machine-generated noise (D3).
 * Both the selector builder and the HTML sanitizer use them: noise makes selectors
 * break on the next build and wastes the agent's tokens in the HTML.
 */

/** Single-word Tailwind/UnoCSS utilities that carry no dash. */
const UTILITY_WORDS = new Set([
  "flex", "inline-flex", "grid", "inline-grid", "block", "inline-block", "inline", "hidden",
  "contents", "table", "relative", "absolute", "fixed", "sticky", "static", "border", "rounded",
  "shadow", "italic", "underline", "uppercase", "lowercase", "capitalize", "truncate", "sr-only",
  "not-sr-only", "container", "transition", "grow", "shrink", "visible", "invisible", "antialiased",
  "isolate", "prose",
]);

/**
 * Prefixes that are utilities whatever follows the dash (`px-4`, `bg-blue-600`, `min-w-full`).
 * A semantic class that happens to start with one of these (`text-editor`) is dropped too;
 * losing one class is cheap, while keeping `bg-blue-600` in a selector breaks it on redesign.
 */
const UTILITY_PREFIX = new RegExp(
  "^-?(" +
    [
      "p[xytrblse]?", "m[xytrblse]?", "min-w", "min-h", "max-w", "max-h", "gap(-[xy])?",
      "space-[xy]", "inset(-[xy])?", "z", "flex", "grid", "grid-cols", "grid-rows", "col-span",
      "row-span", "auto-cols", "auto-rows", "items", "justify", "bg", "text", "font", "leading",
      "tracking", "border", "rounded", "shadow", "divide", "opacity", "duration", "ease", "delay",
      "animate", "translate-[xy]", "rotate", "scale", "skew", "backdrop", "blur", "brightness",
      "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "saturate", "sepia",
    ].join("|") +
    ")-",
);

/**
 * Prefixes that are also common English words in hand-written class names (`list-item`,
 * `top-bar`, `row-actions`): utilities only when followed by a Tailwind-style value.
 */
const AMBIGUOUS_UTILITY = new RegExp(
  "^-?(" +
    [
      "w", "h", "size", "top", "right", "bottom", "left", "order", "basis", "col", "row",
      "content", "self", "place", "ring", "outline", "fill", "stroke", "from", "via", "to",
      "decoration", "overflow", "object", "cursor", "select", "pointer-events", "origin",
      "aspect", "columns", "break", "line-clamp", "whitespace", "list", "align", "float", "clear",
      "accent", "caret", "scroll", "snap", "touch", "will-change", "indent", "shrink", "grow",
    ].join("|") +
    ")-(\\d|px|auto|full|none|screen|min|max|fit|start|end|center|between|around|evenly|stretch|" +
    "baseline|hidden|visible|clip|disc|decimal|inside|outside|pointer|default|wrap|nowrap|normal|" +
    "contain|cover|span|all|transparent|current|inherit|white|black|x-|y-|[a-z]+-\\d)",
);

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

export function isUtilityClass(name: string): boolean {
  // Variants and arbitrary values (`hover:bg-x`, `w-1/2`, `top-[3px]`) are always utilities.
  if (/[:/[\]!]/.test(name)) return true;
  return UTILITY_WORDS.has(name) || UTILITY_PREFIX.test(name) || AMBIGUOUS_UTILITY.test(name);
}

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
