/**
 * Markdown safety helpers. Everything user-derived (transcript, element texts, selectors,
 * URLs, HTML) passes through one of these so the spec never breaks: a stray "*" in a
 * button label must not turn half the document italic.
 */

/**
 * Backslash-escape ASCII punctuation that has inline meaning in CommonMark/GFM:
 * emphasis (* _), code (`), links ([ ]), raw HTML (< >), strikethrough (~) and the
 * backslash itself. Any ASCII punctuation may be escaped, so this is always safe.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>~]/g, "\\$&");
}

/** One-line, trimmed, escaped text: selections can contain newlines that would split a line. */
export function inlineText(text: string): string {
  return escapeMarkdown(oneLine(text));
}

/** Collapse all whitespace (newlines included) to single spaces and trim. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A high surrogate with nothing after it: the low half of its pair was cut off. */
const TRAILING_LONE_SURROGATE = /[\uD800-\uDBFF]$/;

/**
 * Cut text to at most `max` characters, ending with "…" when it was cut.
 * A hard cut at `max - 1` (UTF-16 code units, like .length) can land inside a surrogate
 * pair — e.g. an emoji in a button label — leaving an unpaired surrogate that is not valid
 * Unicode text and can render as a replacement character once written to a file. Dropping
 * that dangling code unit keeps the result within budget and always well-formed.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (TRAILING_LONE_SURROGATE.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}

/** Length of the longest run of consecutive backticks in the text. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Inline code span that survives backticks in its content: CommonMark closes a span only
 * with a backtick run of the same length, so the fence is one longer than any run inside.
 * A space is added on both sides when the content starts or ends with a backtick (the
 * parser strips exactly one such space).
 */
export function codeSpan(text: string): string {
  const content = oneLine(text);
  const fence = "`".repeat(longestBacktickRun(content) + 1);
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${pad}${content}${pad}${fence}`;
}

/** Fenced code block; same idea as codeSpan, with the minimum fence of three backticks. */
export function fencedBlock(content: string, language = ""): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

/**
 * Escape what only matters at the start of a paragraph: headings (#), list bullets (- +),
 * setext underlines (=) and ordered lists ("3." / "3)"). A transcript paragraph starting
 * with "3. " would otherwise render as a numbered list.
 */
export function escapeLineStart(line: string): string {
  const ordered = /^(\d+)([.)])/.exec(line);
  if (ordered) return `${ordered[1]}\\${ordered[2]}${line.slice(ordered[0].length)}`;
  if (/^[#+\-=]/.test(line)) return `\\${line}`;
  return line;
}
