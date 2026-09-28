/**
 * The recorder's one-line event summary (offscreen/event-summary.ts: `tag «name» · gesture`) in
 * words a user knows, for the popup's "Last:"/"Undone:" lines and the pill's Undo notice. One
 * module, so the two places name the same gesture the same way.
 */

/**
 * Words for the elements people point at, instead of HTML tag names ("span «3»" meant nothing to
 * anyone who does not read HTML). A tag with no word here (span, div, a custom element) says
 * nothing a user would recognize, so it is left out and only the element's name is shown.
 * A Map, not an object literal: a tag named "constructor" must not find Object.prototype's.
 */
const WORD_BY_TAG = new Map<string, string>(Object.entries({
  a: "link",
  button: "button",
  input: "field",
  textarea: "field",
  select: "dropdown",
  option: "option",
  label: "label",
  img: "image",
  svg: "icon",
  video: "video",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "paragraph",
  li: "list item",
  table: "table",
  tr: "row",
  th: "column header",
  td: "cell",
  nav: "navigation",
  form: "form",
  dialog: "dialog",
  summary: "summary",
  code: "code",
  pre: "code",
}));

/** Already a word (a summary built with this wording): kept as it is. */
const WORDS = new Set([...WORD_BY_TAG.values(), "element"]);

/** `tag «name» · gesture`, the name being optional; a name may itself contain " · ". */
const SUMMARY = /^([a-z][a-z0-9-]*)(?: «(.*)»)? · (.+)$/s;

/**
 * `a «View report» · Alt+click` → `link “View report”`, `span «3» · Alt+click` → `“3”`,
 * `th «Quantity» · selection` → `column header “Quantity” · selection`. Alt+click is the gesture
 * the hint teaches, so only the others are named. A summary in another shape is shown as it is.
 */
export function readableEvent(summary: string): string {
  const match = SUMMARY.exec(summary);
  if (!match) return summary;
  const [, tag = "", name, gesture = ""] = match;
  const word = WORD_BY_TAG.get(tag) ?? (WORDS.has(tag) ? tag : undefined);
  const quoted = name !== undefined ? `“${name}”` : undefined;
  const element = [word, quoted].filter(Boolean).join(" ") || "element";
  return gesture === "Alt+click" ? element : `${element} · ${gesture}`;
}
