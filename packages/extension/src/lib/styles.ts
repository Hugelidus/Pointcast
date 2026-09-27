/**
 * A few computed style values for the pointed element (ElementInfo.styles). They answer visual
 * requests ("make this bigger", "same blue as the header") without sending a whole stylesheet:
 * the agent sees the current size and color and can grep for them.
 */
const STYLE_PROPERTIES = [
  "color", "background-color", "font-size", "font-weight", "padding", "margin", "display", "width", "height",
];

/** Computed values keyed by CSS property name; undefined when the element has no window. */
export function readStyles(el: Element): Record<string, string> | undefined {
  const view = el.ownerDocument.defaultView;
  if (view === null) return undefined;
  const computed = view.getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const property of STYLE_PROPERTIES) {
    // Shorthands (padding, margin) serialize to "" when their sides cannot be written as one
    // value in some engines; an empty value says nothing, so it is left out.
    const value = computed.getPropertyValue(property).trim();
    if (value !== "") styles[property] = value;
  }
  return Object.keys(styles).length > 0 ? styles : undefined;
}
