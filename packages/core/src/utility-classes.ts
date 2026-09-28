/**
 * Tailwind/UnoCSS utility classes (D3): layout, spacing, sizing, typography and effect classes
 * that say how an element looks, never what it is. The extension drops them from selectors and
 * from the captured HTML; the spec's `find:` line drops them too (for sessions recorded before a
 * utility was known here, e.g. `transition-all`), and the resolver never looks one up
 * (`class at:`, D9 note 2026-09-28).
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
      // Since 2026-09-28: `transition-all`, `ring-sidebar-ring` (shadcn-admin) reached `find:`.
      "transition", "ring",
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

export function isUtilityClass(name: string): boolean {
  // Variants and arbitrary values (`hover:bg-x`, `w-1/2`, `top-[3px]`) are always utilities.
  if (/[:/[\]!]/.test(name)) return true;
  return UTILITY_WORDS.has(name) || UTILITY_PREFIX.test(name) || AMBIGUOUS_UTILITY.test(name);
}

