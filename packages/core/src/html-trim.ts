/**
 * Render-time HTML budget (decision D5). The session already stores sanitized, structurally
 * trimmed HTML (~2000 chars); the Markdown gets a smaller budget, so we trim again here.
 * Budgets live at render time so the .md can be regenerated with other budgets without
 * re-recording.
 */

/** Elements that never have a closing tag, so they are never pushed on the open-tag stack. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Tokenizer: comments, tags (quoted attribute values may contain ">"), text runs, and a lone
 * "<" that does not start a tag (kept as text).
 */
const TOKEN = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;

const ELLIPSIS = "…";

/**
 * Trim HTML to at most `budget` characters without ever cutting inside a tag.
 * Why structural: "first N characters" breaks tags and spends the budget on attribute soup;
 * an agent reads a well-formed prefix far better. When trimmed, the result is
 * `prefix + "…" + closing tags of still-open elements`, and the whole thing fits the budget.
 * Text is cut at a word boundary when one is reasonably close, and never inside an entity.
 */
export function trimHtml(html: string, budget: number): string {
  if (html.length <= budget) return html;

  const open: string[] = [];
  let out = "";
  const closersLength = (stack: readonly string[]) =>
    stack.reduce((total, tag) => total + tag.length + 3, 0);

  for (const token of html.match(TOKEN) ?? []) {
    if (token.startsWith("<") && token.length > 1) {
      const next = applyTag(open, token);
      if (out.length + token.length + ELLIPSIS.length + closersLength(next) > budget) break;
      out += token;
      open.splice(0, open.length, ...next);
      continue;
    }
    const room = budget - out.length - ELLIPSIS.length - closersLength(open);
    if (token.length <= room) {
      out += token;
      continue;
    }
    out += cutText(token, room);
    break;
  }

  const closers = [...open].reverse().map((tag) => `</${tag}>`).join("");
  return out + ELLIPSIS + closers;
}

/** The open-tag stack after `token`. Unknown closing tags are ignored (input may be partial). */
function applyTag(stack: readonly string[], token: string): string[] {
  const next = [...stack];
  const closing = /^<\/([a-zA-Z][\w-]*)/.exec(token);
  if (closing) {
    const index = next.lastIndexOf(closing[1].toLowerCase());
    if (index >= 0) next.length = index;
    return next;
  }
  const opening = /^<([a-zA-Z][\w-]*)/.exec(token);
  if (!opening) return next; // comment, doctype
  const name = opening[1].toLowerCase();
  if (!VOID_ELEMENTS.has(name) && !token.endsWith("/>")) next.push(name);
  return next;
}

/** A high surrogate with nothing after it: the low half of its pair was cut off. */
const TRAILING_LONE_SURROGATE = /[\uD800-\uDBFF]$/;

/**
 * Cut a text run to at most `room` chars, preferring a word boundary, never mid-entity,
 * and never mid-surrogate-pair (an emoji in the captured text would otherwise become an
 * unpaired surrogate, which is not valid Unicode).
 */
function cutText(text: string, room: number): string {
  if (room <= 0) return "";
  let cut = text.slice(0, room);
  if (TRAILING_LONE_SURROGATE.test(cut)) cut = cut.slice(0, -1);
  const atBoundary = /\s/.test(text.charAt(room));
  const lastSpace = cut.search(/\s\S*$/);
  // Only back off to the last space if that keeps at least half of the room;
  // otherwise one very long word would leave almost nothing.
  if (!atBoundary && lastSpace > room / 2) cut = cut.slice(0, lastSpace);
  return cut.replace(/&[#\w]*$/, "").trimEnd();
}
