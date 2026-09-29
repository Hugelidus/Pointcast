import { isShortValue } from "../describe";
import { rootAttributes } from "../element-hints";
import { oneLine, truncate } from "../markdown";
import { isUtilityClass } from "../utility-classes";
import type { CapturedEvent, CodeFrame, ElementInfo, ResolvedLocation, SessionFile, ShownByLocation } from "../schema";
import { cleanPath, codeChain, isLibraryPath } from "./chain";

/**
 * Resolves pointed elements to code locations: pure, with file access injected, so every route
 * (CLI and MCP on the local repo, the extension through the dev server, GitHub) runs the same
 * rules. The rules are Stage 0's repo lookup, which is what passed the bar
 * (docs/eval/stage0-code-pointer-2026-09-27.md, "P-chain-repo"); keep them as they are unless an
 * evaluation says otherwise. Silence beats a wrong location: anything ambiguous yields nothing.
 * Two extensions (resolveElement; docs/decisions.md D9): the files defining the chain's
 * components, only where Stage 0 found nothing (rule 4), and a short value looked up through the
 * item it belongs to (rule 3b), which needs a field Stage 0's sessions did not have (itemLabel).
 * On top of the locations, never changing them: the line that renders a data literal's key
 * (`shownBy`, resolveElementDetails; D9 note 2026-09-28, "shown by").
 */

/** Reads project source for the resolver. */
export interface SourceReader {
  /**
   * Contents of a project-relative file ("src/lib/More.svelte", forward slashes), or undefined
   * when it does not exist or cannot be read. The reader maps the path onto its source: a repo
   * root, a monorepo package prefix, a dev server or GitHub URL. A throw counts as unreadable.
   */
  read(path: string): Promise<string | undefined>;
}

/** Where the source was read, stamped on every ResolvedLocation. */
export type SourceVia = ResolvedLocation["via"];

/**
 * Code locations for one element, [] or exactly one, from its chain (`renderedBy`):
 * 1. its literal, the selected text or else its visible text (then the word runs between numbers,
 *    "Active Now" in "Active Now +573"; for a text joined from several children, only the
 *    leading child's: phrases), written as a code literal exactly once in exactly one
 *    chain file -> "text". Found more than once: nothing, and no further step. Skipped for a short
 *    value that capture tied to its item (itemOf): 3b looks it up through the item instead;
 * 2. else its label, once in the chain files -> "text";
 * 3. else its link's href (not "#…"), once across the chain files and the data modules they
 *    import (one hop), pointing at the element's text next to it when it is there -> "data"
 *    outside the chain (the Chats badge: `badge: '3'` in sidebar-data.ts), "text" inside.
 * 3b. else, for a short value ("3", "+5": isShortValue) with its item's label (`itemLabel`,
 *    "Messages"), that label as a code literal once across the same files as 3, and the value
 *    written on exactly one line of that entry (3's window) -> that line, "data" or "text" as in
 *    3. The label found but the value not next to it: nothing (the count may be computed).
 * 4. when 1-3b found nothing (and no literal was written twice), 1-3b once more over the chain
 *    files plus the files that define the chain's components (withDefinitions), and the data
 *    modules those import. In the most common app shape the component that renders the element
 *    imports its own data (Sidebar.tsx imports NAV_ITEMS), and Sidebar.tsx is where the element
 *    is defined, not a chain file: React 19 and Vue frames are where each instance is USED.
 *    Whatever 1-3 find on the chain alone stays exactly as Stage 0 found it (a location, or
 *    silence over a duplicate): definitions are read only where Stage 0 had nothing to go on.
 *    For server templates (isTemplateFile), the definitions are the templates the chain's
 *    templates `{% include %}` by name (templateIncludes).
 * For a chain of server templates, rule 1 also: searches the innermost template first and the
 * rest of the chain only when it has no hit; ignores scripts, attribute values and `{% if %}`
 * operands (onScreenLines); and breaks a tie by the element's tag (byElementTag).
 * Comments are not code: a literal in a comment is not a hit (withoutComments; in templates also
 * `{# #}` and `{% comment %}`, asTemplateCode).
 * Only those files and their direct imports are read: never a search of the whole project.
 * Each location carries its `snippet` (sourceSnippet), taken from the lines already read, except
 * for a sensitive element: its source line could hold the very text D8 keeps out of a session.
 */
export async function resolveElement(
  element: ElementInfo,
  reader: SourceReader,
  via: SourceVia,
  selectedText?: string,
): Promise<ResolvedLocation[]> {
  return (await resolveElementDetails(element, reader, via, selectedText)).resolved;
}

/** resolveElement's locations, plus the line that renders the value they point at (shownByOf). */
export interface ElementResolution {
  resolved: ResolvedLocation[];
  shownBy?: ShownByLocation;
}

/**
 * resolveElement, plus `shownBy` (D9 note 2026-09-28, "shown by"): when the one location is a
 * data literal under a property key, the line that renders that key (shownByOf). `resolved` is
 * exactly resolveElement's, and finding `shownBy` reads no file resolveElement did not read.
 */
export async function resolveElementDetails(
  element: ElementInfo,
  reader: SourceReader,
  via: SourceVia,
  selectedText?: string,
): Promise<ElementResolution> {
  const cached = cachingReader(reader);
  const chain = new Map<string, string[]>();
  for (const file of chainFiles(element)) {
    const source = await cached.read(file);
    if (source !== undefined) chain.set(file, splitLines(source));
  }
  if (chain.size === 0) return { resolved: [] };
  const text = selectedText ?? element.text;
  let searched: Sources = chain;
  const trace: LookupTrace = {};
  let resolved = await lookup(element, text, chain, cached, via, trace);
  let scope: Sources | undefined;
  if (resolved === undefined) {
    scope = await withDefinitions(element, chain, cached);
    searched = scope;
    resolved = scope.size > chain.size ? await lookup(element, text, scope, cached, via, trace) : undefined;
    resolved ??= (await textInData(element, text, scope, cached, via)) ?? [];
  }
  if (resolved.length === 1 && trace.literal !== undefined && !codeChain(element)[0]?.template) {
    scope ??= await withDefinitions(element, chain, cached);
    resolved = await acrossDefinitions(element, resolved[0], trace.literal, chain, scope, cached, via);
  }
  if (resolved.length === 0 && text.trim() === "") {
    scope ??= await withDefinitions(element, chain, cached);
    resolved = classOrId(element, scope, via);
  }
  const shownBy = resolved.length === 1 ? await shownByOf(element, text, resolved[0], searched, cached, via) : undefined;
  return shownBy === undefined ? { resolved } : { resolved, shownBy };
}

/** What rule 1 matched, when a lookup returned its location: the literal's pattern. */
interface LookupTrace {
  literal?: RegExp;
}

/**
 * Rule 1 checked across the element's own definitions (D9 note 2026-09-28, pass 2). A literal
 * written once in the chain's files can also be written in the file that defines the element's
 * component, or in the data that file imports: a page-title switch in the layout
 * (`case "reports": return "Reports";`) and the nav item's label in the nav component
 * (`{ path: "/reports", label: "Reports" }`). React 19 and Vue frames name where each instance
 * is used, so the definition is often no chain file, and the chain's one hit was the wrong one.
 * So the literal is counted again over the chain's files, the files defining its components
 * (withDefinitions) and the data modules those import (one hop): still once -> the location;
 * more than once -> the tie-break by the element's own tag or component (byEnclosingName), else
 * nothing. A template chain keeps its innermost-first rule: its innermost template is where the
 * element's markup is written, so it is never a usage site.
 */
async function acrossDefinitions(
  element: ElementInfo,
  location: ResolvedLocation,
  pattern: RegExp,
  chain: Sources,
  scope: Sources,
  reader: SourceReader,
  via: SourceVia,
): Promise<ResolvedLocation[]> {
  const wide: Sources = new Map([...scope, ...(await importedData(scope, reader))]);
  if (wide.size === chain.size) return [location];
  const code = codeOf(wide);
  const hits = hitsIn(code, pattern);
  if (hits.length <= 1) return [location];
  const hit = byEnclosingName(hits, code, pattern, element) ?? hrefEntry(element, code, pattern);
  if (hit === undefined) return [];
  if (hit.file === location.file && hit.line === location.line) return [location];
  const snippet = element.sensitive ? undefined : sourceSnippet(wide.get(hit.file) ?? [], hit.line);
  const kind: ResolvedLocation["kind"] = scope.has(hit.file) ? "text" : "data";
  return [{ kind, file: hit.file, line: hit.line, via, ...(snippet === undefined ? {} : { snippet }) }];
}

/**
 * Rule 3 as a tie-break for acrossDefinitions: the element's link href (not "#…") written once
 * across the same files, with the literal on exactly one line of that entry (3's window) -> that
 * line (`{ path: "/reports", label: "Reports" }` for the «Reports» link, not the page-title
 * switch's `return "Reports"`). Else undefined.
 */
function hrefEntry(element: ElementInfo, code: Sources, literal: RegExp): Hit | undefined {
  const href = HREF.exec(element.html)?.[1] ?? HREF.exec(element.selector)?.[1];
  if (href === undefined) return undefined;
  const hits = hitsIn(code, new RegExp(`["'\`]${escapeRegExp(href)}["'\`]`));
  if (hits.length !== 1) return undefined;
  const near = linesNear(code, hits[0], literal);
  return near.length === 1 ? { file: hits[0].file, line: near[0] } : undefined;
}

/**
 * `class at:` / `id at:` (D9 note 2026-09-28, pass 2): an element with no text of its own (a map
 * layer, a container, an icon button) has nothing for rules 1-5 to look up, but often a class or
 * id chosen for it (`className="orders-map"`). Each of the element's own distinctive classes
 * (not a utility, not hashed, not a generic word: distinctiveClasses) and its id (not generated)
 * is looked up in the chain's files and the files defining its components, as a class token in a
 * class attribute or class helper call, or as an `id` value. Candidates written exactly once
 * there count; when they all point at the same line -> that line. None, or two lines: nothing.
 */
function classOrId(element: ElementInfo, files: Sources, via: SourceVia): ResolvedLocation[] {
  const attributes = rootAttributes(element.html);
  const code = codeOf(files);
  const found: { kind: "class" | "id"; hit: Hit }[] = [];
  // Only on the element's own tag (`<div className="orders-map"`): a class a wrapper sets on
  // whatever it renders (`<component :is="chart" class="va-chart" />`) names the wrapper's line,
  // shared by every instance, not this element.
  const onOwnTag = (hit: Hit, pattern: RegExp): boolean => {
    const lines = code.get(hit.file) ?? [];
    const line = lines[hit.line - 1] ?? "";
    const at = pattern.exec(line)?.index ?? line.length;
    const context = `${lines.slice(Math.max(0, hit.line - 6), hit.line - 1).join(" ")} ${line.slice(0, at)}`;
    const opened = [...context.matchAll(/<([A-Za-z][\w.-]*)/g)].pop();
    return opened !== undefined && opened[1].toLowerCase() === element.tag.toLowerCase() && !context.slice(opened.index).includes(">");
  };
  const id = attributes.get("id");
  if (id !== undefined && isDistinctiveName(id) && !GENERATED_ID.test(id)) {
    const pattern = new RegExp(`\\bid\\s*[=:]\\s*\\{?\\s*["'\`]${escapeRegExp(id)}["'\`]`);
    const hits = hitsIn(code, pattern);
    if (hits.length === 1 && onOwnTag(hits[0], pattern)) found.push({ kind: "id", hit: hits[0] });
  }
  for (const name of distinctiveClasses(attributes.get("class") ?? "")) {
    const token = new RegExp(`(?:class|className|:class|\\bcn|\\bclsx|\\bcva|classList|\\btw)\\b[^\\n]*?["'\`\\s]${escapeRegExp(name)}(?=["'\`\\s])`);
    const hits = hitsIn(code, token);
    if (hits.length === 1 && onOwnTag(hits[0], token)) found.push({ kind: "class", hit: hits[0] });
  }
  if (found.length === 0) return [];
  const [{ kind, hit }] = found;
  if (found.some((other) => other.hit.file !== hit.file || other.hit.line !== hit.line)) return [];
  const snippet = element.sensitive ? undefined : sourceSnippet(files.get(hit.file) ?? [], hit.line);
  return [{ kind, file: hit.file, line: hit.line, via, ...(snippet === undefined ? {} : { snippet }) }];
}

/** Generated ids carry no meaning in the source (as element-hints.ts's GENERATED_ID). */
const GENERATED_ID = /^:|[«»:]|^(radix|headlessui|mui|react-aria|rc-|ember|downshift)-|\d{4,}|^[\da-f]{8}-[\da-f]{4}-/i;

/** Class names too common to say which element they are on. */
const GENERIC_CLASSES = new Set([
  "active", "body", "btn", "button", "card", "col", "container", "content", "disabled", "footer",
  "header", "hidden", "icon", "inner", "item", "label", "link", "list", "main", "open", "outer",
  "row", "selected", "show", "title", "wrapper", "root", "dark", "light", "group", "peer",
]);

/** A name worth looking up: at least 3 characters, a letter, no generic word. */
function isDistinctiveName(name: string): boolean {
  return name.length >= 3 && /[a-z]/i.test(name) && !GENERIC_CLASSES.has(name.toLowerCase());
}

/** The element's own classes that are neither utilities, hashed, nor generic words. */
function distinctiveClasses(value: string): string[] {
  return value
    .split(/\s+/)
    .filter((name) => name !== "" && isDistinctiveName(name) && !isUtilityClass(name) && !/\d{4,}|__[\w-]{3,}$|^(css|sc|svelte|jsx)-/.test(name) && /^[\w-]+$/.test(name));
}

/**
 * Rule 5 (D9 note 2026-09-28, Next.js): the element's literal (rule 1's phrases), once across the
 * data modules the searched files import (one hop, as rule 3), when rules 1-4 found nothing and
 * no literal was written twice in the component files. A Server Component renders its data where
 * it reads it (`{order.customer}`, `{stat.label}`), so the text is only in the data module.
 * The component files themselves were searched already: a hit there would have been rule 1's.
 * Written more than once across the data modules: nothing. Skipped for a short value tied to its
 * item (rule 3b's case): a lone "3" in a data file says nothing.
 */
async function textInData(element: ElementInfo, text: string, files: Sources, reader: SourceReader, via: SourceVia): Promise<ResolvedLocation[] | undefined> {
  if (itemOf(element, text) !== undefined) return undefined;
  const data = await importedData(files, reader);
  if (data.size === 0) return undefined;
  const code = codeOf(data);
  for (const phrase of phrasesOf(element, text)) {
    const hits = hitsIn(code, literalPattern(phrase));
    if (hits.length > 1) return undefined;
    if (hits.length === 1) {
      const snippet = element.sensitive ? undefined : sourceSnippet(data.get(hits[0].file) ?? [], hits[0].line);
      return [{ kind: "data", file: hits[0].file, line: hits[0].line, via, ...(snippet === undefined ? {} : { snippet }) }];
    }
  }
  return undefined;
}

/**
 * The line that renders the value at `location` ("shown by"), or undefined:
 * 1. the location's line holds the element's text (or one of its phrases) as the value of exactly
 *    one property, `customer: "Marco Peña"`, `"customer": "…"` or `badge: 3` -> that key. A value
 *    that is no property (`<td>Export</td>`, `title="Sales Report"`), or two properties with it
 *    on the line: nothing;
 * 2. the files the lookup searched (`files`: the chain, or the chain plus the definitions for
 *    rule 4), innermost first, and never the data modules: in the first one that renders that key
 *    at all (renderingsOf), exactly one rendering -> that line. Two or more there: nothing, and no
 *    further file.
 * No file is read here: the location's file and `files` were all read by the lookup.
 */
async function shownByOf(
  element: ElementInfo,
  text: string,
  location: ResolvedLocation,
  files: Sources,
  reader: SourceReader,
  via: SourceVia,
): Promise<ShownByLocation | undefined> {
  const source = files.get(location.file) ?? (await reader.read(location.file).then((read) => (read === undefined ? undefined : splitLines(read))));
  if (source === undefined) return undefined;
  const key = propertyKey(codeLines(location.file, source)[location.line - 1] ?? "", text, htmlOfText(element, text));
  if (key === undefined) return undefined;
  for (const [file, lines] of files) {
    const found = renderingsOf(key, file, lines);
    if (found.length === 0) continue;
    if (found.length > 1) return undefined;
    if (file === location.file && found[0] === location.line) return undefined;
    const snippet = element.sensitive ? undefined : sourceSnippet(lines, found[0]);
    return { key, file, line: found[0], via, ...(snippet === undefined ? {} : { snippet }) };
  }
  return undefined;
}

/**
 * A property and its value, as written in an object literal or JSON: a key (bare or quoted) right
 * after `{`, `,` or the line start, `:`, then a quoted string or a bare token (`3`, `true`).
 * The `{`/`,` before a key keeps out a ternary's `? "a" : "b"`.
 */
const PROPERTY =
  /(?:^|[{,])\s*(?:(["'])([A-Za-z_$][\w$-]*)\1|([A-Za-z_$][\w$]*))\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^\s,}\]"'`]+))/g;

/** The key of the one property on `line` whose value is the element's text or one of its phrases. */
export function propertyKey(line: string, text: string, html?: string): string | undefined {
  const values = new Set(phrases(text, html));
  const keys: string[] = [];
  for (const match of line.matchAll(PROPERTY)) {
    const value = (match[4] ?? match[5] ?? match[6] ?? match[7] ?? "").replace(/\s+/g, " ").trim();
    if (value.includes("${")) continue;
    if (values.has(value)) keys.push(match[2] ?? match[3]);
  }
  return keys.length === 1 ? keys[0] : undefined;
}

/** `order.`, `row.order.`, `order?.`: the object path before a key, any depth, or none. */
const OBJECT_PATH = "(?:[A-Za-z_$][\\w$]*\\??\\.)*";

/**
 * The 1-based line of every expression in `file` that renders `key` as element content, one entry
 * per rendering:
 * - `{{ x.key }}`, `{{ key }}`, `{{ x?.key }}`, with filters or pipes (`{{ x.key|upper }}`) and
 *   Jinja's `{{- … -}}`: Vue, Django, Jinja, and any other file;
 * - `{x.key}`, `{key}`, `{x?.key}`, Svelte's `{@html x.key}`: JSX and Svelte (not `.vue` or
 *   templates, where a single brace is script, and not `${…}`).
 * Never an attribute value (`key={o.id}`, `title="{{ x.key }}"`, `:title="…"`), an expression
 * inside a tag on its line (Svelte's `<Row {customer} />`), or a single brace that reads as
 * script: destructuring (`const { customer } =`), a call's argument, a shorthand property.
 * Only these exact forms: `{format(x.key)}` or `{x.key.toUpperCase()}` render it too but are not
 * counted, so a file with only those gives nothing. Comments are not code (withoutComments; in
 * templates also `{# #}` and `{% comment %}`).
 */
export function renderingsOf(key: string, file: string, lines: readonly string[]): number[] {
  const name = escapeRegExp(key);
  const patterns = [new RegExp(`\\{\\{-?\\s*${OBJECT_PATH}${name}\\s*(?:\\|[^{}]*)?-?\\}\\}`, "g")];
  const single = !isTemplateFile(file) && !/\.vue$/i.test(file);
  if (single) patterns.push(new RegExp(`(?<![{$])\\{\\s*(?:@html\\s+)?${OBJECT_PATH}${name}\\s*\\}(?!\\})`, "g"));
  const code = isTemplateFile(file) ? withoutComments(withoutTemplateHidden(lines)) : withoutComments(lines);
  const found: number[] = [];
  code.forEach((line, i) => {
    if (/^\s*(import|export)\b/.test(line)) return;
    patterns.forEach((pattern, p) => {
      for (const match of line.matchAll(pattern)) {
        const before = line.slice(0, match.index);
        const after = line.slice(match.index + match[0].length);
        if (/=\s*["']?\s*$/.test(before) || insideTag(before)) continue;
        if (p === 1 && readsAsScript(before, after)) continue;
        found.push(i + 1);
      }
    });
  });
  return found;
}

/** True when `before` (a line up to a match) has an opening tag that is not closed yet. */
function insideTag(before: string): boolean {
  const open = before.search(/<[A-Za-z][^<]*$/);
  return open >= 0 && before.lastIndexOf(">") < open;
}

/** A single-brace match that is script, not markup: `const { a } =`, `f({ a })`, `[{ a }, …]`, `{ a };`. */
function readsAsScript(before: string, after: string): boolean {
  return /(?:[(,:?]|\b(?:const|let|var|return|function)|=>)\s*$/.test(before) || /^\s*[=,:;)]/.test(after);
}

/**
 * Rules 1-3b of resolveElement over `files`: a location; [] when the literal is written more than
 * once (silence, and no further step); undefined when nothing was found.
 */
async function lookup(
  element: ElementInfo,
  text: string,
  files: Sources,
  reader: SourceReader,
  via: SourceVia,
  trace: LookupTrace = {},
): Promise<ResolvedLocation[] | undefined> {
  const at = (kind: ResolvedLocation["kind"], hit: Hit, from: Sources): ResolvedLocation[] => {
    const snippet = element.sensitive ? undefined : sourceSnippet(from.get(hit.file) ?? [], hit.line);
    return [{ kind, file: hit.file, line: hit.line, via, ...(snippet === undefined ? {} : { snippet }) }];
  };
  const code = codeOf(files);
  const item = itemOf(element, text);
  // Templates (D9 note 2026-09-28): the text is searched where it can be on screen, in the
  // innermost template first (where the element's markup is written), with the tag filter.
  const onScreen = new Map([...code].map(([file, lines]) => [file, isTemplateFile(file) ? onScreenLines(files.get(file) ?? []) : lines]));
  const innermost = codeChain(element)[0];
  const first = innermost?.template && onScreen.has(innermost.file) ? new Map([[innermost.file, onScreen.get(innermost.file)!]]) : undefined;

  for (const phrase of item === undefined ? phrasesOf(element, text) : []) {
    const pattern = literalPattern(phrase);
    let hits = first === undefined ? [] : hitsIn(first, pattern);
    if (hits.length === 0) hits = hitsIn(onScreen, pattern);
    if (hits.length === 1) {
      trace.literal = pattern;
      return at("text", hits[0], files);
    }
    if (hits.length > 1) {
      const tagged = hits.every((hit) => isTemplateFile(hit.file))
        ? byElementTag(hits, onScreen, pattern, element.tag)
        : byEnclosingName(hits, onScreen, pattern, element);
      if (tagged !== undefined) trace.literal = pattern;
      return tagged === undefined ? [] : at("text", tagged, files);
    }
  }

  if (element.label) {
    const hits = hitsIn(code, new RegExp(escapeRegExp(element.label)));
    if (hits.length === 1) return at("text", hits[0], files);
  }

  const href = HREF.exec(element.html)?.[1] ?? HREF.exec(element.selector)?.[1];
  if (href === undefined && item === undefined) return undefined;
  const pool = new Map([...files, ...(await importedData(files, reader))]);
  const poolCode = codeOf(pool);
  const kind = (hit: Hit): ResolvedLocation["kind"] => (files.has(hit.file) ? "text" : "data");

  if (href !== undefined) {
    const hits = hitsIn(poolCode, new RegExp(`["'\`]${escapeRegExp(href)}["'\`]`));
    if (hits.length === 1) {
      const hit = hits[0];
      // In a data file the element's own text is usually a line or two away, in the same entry.
      const near = text.trim() === "" ? [] : linesNear(poolCode, hit, literalPattern(text.trim()));
      return at(kind(hit), { file: hit.file, line: near.length === 1 ? near[0] : hit.line }, pool);
    }
  }

  if (item !== undefined) {
    const hits = hitsIn(poolCode, literalPattern(item));
    if (hits.length === 1) {
      // Unlike an href, the label says which entry, not where the value is: no line without it.
      const near = linesNear(poolCode, hits[0], literalPattern(text.trim(), ENTRY_END));
      if (near.length === 1) return at(kind(hits[0]), { file: hits[0].file, line: near[0] }, pool);
    }
  }
  return undefined;
}

/**
 * The label of the item a short value belongs to (ElementInfo.itemLabel, rule 3b), when the text
 * looked up is that short value. Without one (older sessions, a badge alone in its button) the
 * value goes through rule 1 like any text, as in Stage 0: vuestic's «2+» is found there, written
 * once (`<template #text> 2+</template>`), and must stay found.
 */
function itemOf(element: ElementInfo, text: string): string | undefined {
  const label = typeof element.itemLabel === "string" ? oneLine(element.itemLabel) : "";
  return label !== "" && isShortValue(text) ? label : undefined;
}

/** Lines (1-based) matching `pattern` within the entry around a hit: 3 lines either side. */
function linesNear(code: Sources, hit: Hit, pattern: RegExp): number[] {
  const lines = code.get(hit.file) ?? [];
  const near: number[] = [];
  for (let i = Math.max(0, hit.line - 4); i < Math.min(lines.length, hit.line + 3); i++) {
    if (pattern.test(lines[i])) near.push(i + 1);
  }
  return near;
}

/**
 * A copy of the session with `ElementInfo.resolved` (and `shownBy`, resolveElementDetails) set for every element that has a chain and
 * whose chain files could be read, and a `snippet` on each `renderedBy` frame with a line whose
 * file was read (not for sensitive elements, D8); nothing is mutated, and snippets need no extra read. An element keeps what it had when
 * none of its chain files was readable (e.g. resolved earlier through another route), and loses
 * `resolved` when the source was read and nothing unambiguous was found.
 */
export async function resolveSession(session: SessionFile, reader: SourceReader, via: SourceVia): Promise<SessionFile> {
  const cached = cachingReader(reader);
  const events = await Promise.all(
    session.events.map(async (event): Promise<CapturedEvent> => {
      const files = chainFiles(event.element);
      const sources = await Promise.all(files.map((file) => cached.read(file)));
      if (sources.every((source) => source === undefined)) return event;
      const { resolved, shownBy } = await resolveElementDetails(event.element, cached, via, event.selection?.text);
      const read = new Map<string, string[]>();
      files.forEach((file, i) => {
        const source = sources[i];
        if (source !== undefined) read.set(file, splitLines(source));
      });
      const { resolved: _previous, shownBy: _previousShownBy, ...element } = event.element;
      if (Array.isArray(element.renderedBy) && !element.sensitive) element.renderedBy = withSnippets(element.renderedBy, read);
      return {
        ...event,
        element: { ...element, ...(resolved.length > 0 ? { resolved } : {}), ...(shownBy === undefined ? {} : { shownBy }) },
      };
    }),
  );
  return { ...session, events };
}

/** Whether the source a reader sees is the project a session was recorded on. */
export interface ProjectMatch {
  /**
   * false: none of the files named by the session's chains could be read, so the session is
   * probably from another project (or the reader's root is wrong); worth a warning. true: at
   * least one could. undefined: the session names no files (no `renderedBy`), nothing to check.
   */
  matches: boolean | undefined;
  /** Every project-relative file the session's chains name, in order of first appearance. */
  files: string[];
  /** The subset the reader could read. */
  readable: string[];
}

export async function projectMatch(session: SessionFile, reader: SourceReader): Promise<ProjectMatch> {
  const files = [...new Set(session.events.flatMap((event) => chainFiles(event.element)))];
  const sources = await Promise.all(files.map((file) => readSource(reader, file)));
  const readable = files.filter((_, i) => sources[i] !== undefined);
  return { matches: files.length === 0 ? undefined : readable.length > 0, files, readable };
}

/**
 * A reader that reads each path at most once (the same chain files recur across a session's
 * elements) and turns a throw into "unreadable". Share one between projectMatch and
 * resolveSession to avoid reading twice over a network.
 */
export function cachingReader(reader: SourceReader): SourceReader {
  const cache = new Map<string, Promise<string | undefined>>();
  return {
    read(path) {
      let source = cache.get(path);
      if (source === undefined) {
        source = readSource(reader, path);
        cache.set(path, source);
      }
      return source;
    },
  };
}

/** Longest snippet kept and rendered (CodeFrame.snippet, ResolvedLocation.snippet). */
export const MAX_SNIPPET_CHARS = 200;

/** A line shorter than this says little alone ("Export", "badge: '3',"): its neighbours come with it. */
const SHORT_LINE_CHARS = 16;

/**
 * The source at a 1-based line, as the spec quotes it: the line, whitespace-collapsed, plus the
 * lines just before and after it (when not blank) if it is shorter than SHORT_LINE_CHARS, cut to
 * MAX_SNIPPET_CHARS. undefined for a blank line or a line past the end.
 */
export function sourceSnippet(lines: readonly string[], line: number): string | undefined {
  const own = oneLine(lines[line - 1] ?? "");
  if (own === "") return undefined;
  const text =
    own.length >= SHORT_LINE_CHARS
      ? own
      : [lines[line - 2], own, lines[line]]
          .map((around) => oneLine(around ?? ""))
          .filter((around) => around !== "")
          .join(" ");
  return truncate(text, MAX_SNIPPET_CHARS);
}

// ------------------------------------------------------------------------------------ internals

/**
 * renderedBy with a fresh `snippet` on each frame with a line whose file was read; any other frame
 * is kept as it was. Paths are matched the way chainFiles builds them.
 */
function withSnippets(frames: readonly CodeFrame[], read: ReadonlyMap<string, string[]>): CodeFrame[] {
  return frames.map((frame) => {
    if (typeof frame !== "object" || frame === null || typeof frame.file !== "string") return frame;
    const path = safePath(cleanPath(frame.file));
    const lines = path === undefined ? undefined : read.get(path);
    if (lines === undefined) return frame;
    const { snippet: _previous, ...rest } = frame;
    const line = frame.line;
    const snippet = typeof line === "number" && Number.isInteger(line) && line > 0 ? sourceSnippet(lines, line) : undefined;
    return snippet === undefined ? rest : { ...rest, snippet };
  });
}

interface Hit {
  file: string;
  line: number;
}

/** Files read for the lookup: project-relative path -> its lines, in search order. */
type Sources = ReadonlyMap<string, string[]>;

/** A non-fragment href in the element's HTML, else in its selector (a[href="/chats"] > span). */
const HREF = /href="([^"#][^"]*)"/;

/**
 * What an import may point at: the extensions accepted when the specifier has one, and the ones
 * tried, in order, when it has none (then as "/index.<ext>").
 */
interface ImportKind {
  accept: ReadonlySet<string>;
  probe: readonly string[];
}

/** Data modules followed by the one import hop: script and JSON, not components. */
const DATA: ImportKind = { accept: new Set(["ts", "js", "mjs", "cjs", "json"]), probe: ["ts", "js"] };

/**
 * Files a component is defined in. ".tsx" before ".js": a Vite dev server also serves
 * "Sidebar.js?raw" for a "Sidebar.tsx" (see importedData), under the wrong name.
 */
const COMPONENT_EXTENSIONS = ["tsx", "ts", "jsx", "js", "vue", "svelte"];
const COMPONENT: ImportKind = { accept: new Set(COMPONENT_EXTENSIONS), probe: COMPONENT_EXTENSIONS };

/** Unique chain files that are safe to hand to a reader, innermost first. */
function chainFiles(element: ElementInfo): string[] {
  return [...new Set(codeChain(element).flatMap((frame) => safePath(frame.file) ?? []))];
}

/**
 * Only paths inside the project reach a reader: a session can come from someone else, and its
 * renderedBy is page-controlled dev data, so "../../.ssh/id_rsa" or a URL is refused here too.
 */
function safePath(path: string): string | undefined {
  const clean = path.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
  if (clean === "" || clean.includes("\0") || /^[a-z][a-z\d+.-]*:/i.test(clean)) return undefined;
  return clean.split("/").some((segment) => segment === "..") ? undefined : clean;
}

async function readSource(reader: SourceReader, path: string): Promise<string | undefined> {
  try {
    const source = await reader.read(path);
    return typeof source === "string" ? source : undefined;
  } catch {
    return undefined;
  }
}

function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}

/** The same files with their comments blanked out (withoutComments): what the lookup searches. */
function codeOf(files: Sources): Map<string, string[]> {
  return new Map([...files].map(([file, lines]) => [file, codeLines(file, lines)]));
}

/** A file's lines as the lookup searches them: comments out, and template tags as boundaries. */
function codeLines(file: string, lines: readonly string[]): string[] {
  if (isTemplateFile(file)) return withoutComments(asTemplateCode(lines));
  return NEXT_ROUTE_FILE.test(file) ? withoutNextMetadata(withoutComments(lines)) : withoutComments(lines);
}

/** Next.js App Router files that may export the page's `metadata` (D9 note 2026-09-28). */
const NEXT_ROUTE_FILE = /(^|\/)(layout|page|template|default|not-found)\.(tsx|jsx|ts|js)$/;
const NEXT_METADATA_START = /^\s*export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b)/;

/**
 * A Next.js route file's lines with its `metadata` export (or `generateMetadata`) blanked, line
 * for line: it fills the document head (`<title>`, `<meta>`), never the page, like a template's
 * title block. The root layout's `title: "Acme Ops"` would otherwise make the sidebar's «Acme Ops»
 * look written twice. The block ends where its braces balance again; brace counting, no parser.
 */
function withoutNextMetadata(lines: readonly string[]): string[] {
  let inside = false;
  let depth = 0;
  let opened = false;
  return lines.map((line) => {
    if (!inside && NEXT_METADATA_START.test(line)) {
      inside = true;
      depth = 0;
      opened = false;
    }
    if (!inside) return line;
    for (const char of line) {
      if (char === "{") {
        depth++;
        opened = true;
      } else if (char === "}") {
        depth--;
      }
    }
    // No brace on its first line and a ";" to end it: `export const metadata = siteMetadata;`.
    if ((opened && depth <= 0) || (!opened && /;\s*$/.test(line))) inside = false;
    return "";
  });
}

/**
 * Server-side template files (Django, Jinja; D9 note 2026-09-28): `.html`, `.htm`, `.djhtml`,
 * `.jinja`, `.jinja2`, `.j2`. The chain names them when pointcast-django's markers are on the
 * page. Their own comment syntax and tag delimiters are handled only here (asTemplateCode):
 * `{#` opens a block in Svelte (`{#if}`), so never in `.svelte`, `.vue` or script files.
 */
export function isTemplateFile(file: string): boolean {
  return /\.(html?|djhtml|jinja2?|j2)$/i.test(file);
}

/**
 * What a template writes that is never on screen, so never the element pointed at: comments,
 * `{#` … `#}` (Django: one line; Jinja: any) and `{% comment %}` … `{% endcomment %}` (Django),
 * and the document title, `<title>` … `</title>` and `{% block title %}` … `{% endblock %}`.
 * A title block usually repeats the page's heading (`{% block title %}Envios FBA{% endblock %}`
 * and `<h1>Envios FBA</h1>`): searched, it would make the heading look written twice.
 */
const TEMPLATE_HIDDEN_START = /\{#|\{%-?\s*comment\b[^%]*%\}|\{%-?\s*block\s+title\s*-?%\}|<title\b[^>]*>/i;

function hiddenEnd(start: string): RegExp {
  if (start === "{#") return /#\}/;
  if (/^<title/i.test(start)) return /<\/title\s*>/i;
  return /comment/.test(start) ? /\{%-?\s*endcomment\s*-?%\}/ : /\{%-?\s*endblock\b[^%]*%\}/;
}

/**
 * A template's lines as code, line for line: what is never on screen blanked out (comments and
 * the title, TEMPLATE_HIDDEN_START) like withoutComments does for `<!-- -->`, and its tag
 * delimiters turned into `<` and `>` of the same length (`{{` -> `<{`, `}}` -> `}>`, `{%` -> `<%`,
 * `%}` -> `%>`). A literal next to a tag is then bounded like one next to an HTML tag: «Activo» in
 * `{% if a %}Activo{% else %}`, «Pedidos (» in `Pedidos ({{ n }})`. Quoted literals inside tags
 * (`{% translate "Guardar" %}`) keep their quotes.
 */
function asTemplateCode(lines: readonly string[]): string[] {
  return withoutTemplateHidden(lines).map(delimitersAsTags);
}

/** The lines without what TEMPLATE_HIDDEN_START opens, line for line. */
function withoutTemplateHidden(lines: readonly string[]): string[] {
  let end: RegExp | undefined;
  return lines.map((line) => {
    let code = "";
    let rest = line;
    for (;;) {
      if (end !== undefined) {
        const close = end.exec(rest);
        if (close === null) return code;
        rest = ` ${rest.slice(close.index + close[0].length)}`;
        end = undefined;
      }
      const start = TEMPLATE_HIDDEN_START.exec(rest);
      if (start === null) return code + rest;
      code += rest.slice(0, start.index);
      end = hiddenEnd(start[0]);
      rest = rest.slice(start.index + start[0].length);
    }
  });
}

/**
 * A template's lines as rule 1 searches them for the element's text (D9 note 2026-09-28, second
 * part): the code view (codeLines) minus what is never an element's visible text, blanked with
 * spaces so lines and columns stay: `<script>` and `<style>` contents, quoted attribute values
 * (`class="{% if a %}active{% endif %}"`, `title="…"`, `data-…`), and the quoted operands of
 * `{% if %}`/`{% elif %}` (`{% if estado == 'enviada' %}`). `{% trans "Guardar" %}` and
 * `{% blocktrans %}` keep their text. Labels and hrefs, which live in attributes, are still
 * searched in the code view (rules 2 and 3).
 */
function onScreenLines(lines: readonly string[]): string[] {
  const source = withoutComments(withoutTemplateHidden(lines)).join("\n");
  const lower = source.toLowerCase();
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  const templateEnd = (at: number): number => {
    const close = source.indexOf(source[at + 1] === "%" ? "%}" : "}}", at + 2);
    return close < 0 ? source.length : close + 2;
  };
  let inTag = false;
  let tagName = "";
  let closing = false;
  let i = 0;
  while (i < source.length) {
    if (source[i] === "{" && (source[i + 1] === "%" || source[i + 1] === "{")) {
      const end = templateEnd(i);
      if (/^\{%-?\s*(el)?if\b/.test(source.slice(i, end))) {
        for (const quoted of source.slice(i, end).matchAll(/(["'])[^"'\n]*\1/g)) blank(i + quoted.index, i + quoted.index + quoted[0].length);
      }
      i = end;
      continue;
    }
    const char = source[i];
    if (!inTag) {
      const tag = char === "<" ? /^<(\/?)([a-zA-Z][\w-]*)/.exec(source.slice(i, i + 64)) : null;
      if (tag !== null) {
        inTag = true;
        closing = tag[1] === "/";
        tagName = tag[2].toLowerCase();
        i += tag[0].length;
      } else {
        i++;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== char) j = source[j] === "{" && (source[j + 1] === "%" || source[j + 1] === "{") ? templateEnd(j) : j + 1;
      if (j - i > MAX_ATTRIBUTE_CHARS) {
        i++; // An unbalanced quote: not an attribute value to trust; leave the rest as it is.
        continue;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    if (char === ">") {
      inTag = false;
      i++;
      if (!closing && (tagName === "script" || tagName === "style")) {
        const end = lower.indexOf(`</${tagName}`, i);
        const stop = end < 0 ? source.length : end;
        blank(i, stop);
        i = stop;
      }
      continue;
    }
    i++;
  }
  return out.join("").split("\n").map(delimitersAsTags);
}

/** A quoted value longer than this is taken for a stray quote, not an attribute value. */
const MAX_ATTRIBUTE_CHARS = 4000;

/** Tags with no content: skipped when looking for the tag a text is written in. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * The name of the HTML element a literal found at `at` in an on-screen line (onScreenLines) is
 * written in, when that line shows it: the opening tag right before the literal, past template
 * tags (`<span>{% if a %}Activo`), void and self-closing tags, and empty elements
 * (`<a><i class="bi bi-plus"></i> Nuevo`). Undefined otherwise (the tag is on another line, a
 * closing tag of a non-empty element comes first): then the tag filter does not apply.
 */
function enclosingTagName(line: string, at: number): string | undefined {
  let before = line.slice(0, at);
  for (;;) {
    before = before.trimEnd();
    if (before.endsWith("%>") || before.endsWith("}>")) {
      const start = before.lastIndexOf(before.endsWith("%>") ? "<%" : "<{");
      if (start < 0) return undefined;
      before = before.slice(0, start);
      continue;
    }
    if (!before.endsWith(">")) return undefined;
    const start = before.lastIndexOf("<");
    const tag = start < 0 ? null : /^<(\/?)([a-zA-Z][\w-]*)\b[^<>]*?(\/?)>$/.exec(before.slice(start));
    if (tag === null) return undefined;
    const name = tag[2].toLowerCase();
    if (tag[1] === "/") {
      const rest = before.slice(0, start).trimEnd();
      const open = rest.lastIndexOf("<");
      if (open < 0 || !new RegExp(`^<${name}\\b[^<>]*>$`, "i").test(rest.slice(open)) || rest.endsWith("/>")) return undefined;
      before = rest.slice(0, open);
      continue;
    }
    if (tag[3] === "/" || VOID_TAGS.has(name)) {
      before = before.slice(0, start);
      continue;
    }
    return name;
  }
}

/**
 * Rule 1's tie-break for templates (tag filter): of several hits of a literal, all in template
 * files, the only one written in the element's own tag (`<th>Estado</th>` for a th, not the
 * filter's `<label>Estado</label>`). Only when every hit's tag shows on its line and the literal
 * is there once; else undefined, and the lookup stays silent as before.
 */
function byElementTag(hits: readonly Hit[], text: Sources, pattern: RegExp, tag: string): Hit | undefined {
  const global = new RegExp(pattern.source, "g");
  const matching: Hit[] = [];
  for (const hit of hits) {
    if (!isTemplateFile(hit.file)) return undefined;
    const line = text.get(hit.file)?.[hit.line - 1] ?? "";
    const found = [...line.matchAll(global)];
    if (found.length !== 1) return undefined;
    const name = enclosingTagName(line, found[0].index + found[0][1].length);
    if (name === undefined) return undefined;
    if (name === tag.toLowerCase()) matching.push(hit);
  }
  return matching.length === 1 ? matching[0] : undefined;
}

/** How many lines up the tag a literal is written in is looked for (JSX text on its own line). */
const ENCLOSING_LOOKBACK = 12;

/**
 * Rule 1's tie-break for component files (JSX, Vue, Svelte; D9 note 2026-09-28, pass 2), the
 * counterpart of byElementTag: of several hits of a literal, the only one written as the content
 * of the element's own component or tag (`<CardTitle>Overview</CardTitle>` for a CardTitle, not
 * the tab's `<TabsTrigger value='overview'>Overview</TabsTrigger>`). Each hit is either:
 * - markup text (not right after a quote): its enclosing tag must be found, on its line or in the
 *   lines above it (enclosingTagName), else there is no telling and the answer is undefined;
 * - a quoted string (`title: 'Overview'`, a prop, a `case`): not the content of any tag here.
 * Exactly one markup hit in the element's component (`element.component.name`) or tag, compared
 * without case, wins, and quoted strings are set aside only when nothing in the files renders an
 * expression as the content of that component or tag (`<CardTitle>{title}</CardTitle>`): such an
 * element could be showing one of those strings. Anything else: undefined, and silence.
 */
function byEnclosingName(hits: readonly Hit[], text: Sources, pattern: RegExp, element: ElementInfo): Hit | undefined {
  if (hits.some((hit) => isTemplateFile(hit.file))) return undefined;
  const names = new Set([element.tag.toLowerCase()]);
  const component = typeof element.component?.name === "string" ? element.component.name : "";
  if (/^[A-Za-z][\w-]*$/.test(component)) names.add(component.toLowerCase());
  const global = new RegExp(pattern.source, "g");
  const matching: Hit[] = [];
  let strings = 0;
  for (const hit of hits) {
    const lines = text.get(hit.file) ?? [];
    const line = lines[hit.line - 1] ?? "";
    const found = [...line.matchAll(global)];
    if (found.length !== 1) return undefined;
    const start = found[0].index + found[0][1].length;
    const before = line.slice(0, start);
    const quoted = /["'`]$/.test(before.trimEnd()) || (before.trim() === "" && /["'`]\s*$/.test(lines[hit.line - 2] ?? ""));
    if (quoted) {
      strings++;
      continue;
    }
    const above = lines.slice(Math.max(0, hit.line - 1 - ENCLOSING_LOOKBACK), hit.line - 1).join(" ");
    const context = before.trim() === "" ? `${above} ${before}` : before;
    const name = enclosingTagName(context, context.length);
    if (name === undefined) return undefined;
    if (names.has(name)) matching.push(hit);
  }
  if (matching.length !== 1) return undefined;
  if (strings > 0 && rendersExpressionIn(names, text)) return undefined;
  return matching[0];
}

/** True when some file writes `<Name …>{…` (an expression as the content of that tag or component). */
function rendersExpressionIn(names: ReadonlySet<string>, files: Sources): boolean {
  const alternatives = [...names].map(escapeRegExp).join("|");
  const pattern = new RegExp(`<(?:${alternatives})(?:\\s[^<>]*)?>\\s*\\{`, "i");
  for (const lines of files.values()) {
    if (pattern.test(lines.join("\n"))) return true;
  }
  return false;
}

function delimitersAsTags(line: string): string {
  return line.replace(/\{\{|\{%/g, (open) => `<${open[1]}`).replace(/\}\}|%\}/g, (close) => `${close[0]}>`);
}

/**
 * Where a comment starts: `<!--` anywhere; `//` and `/*` at the start of a line or after
 * whitespace, `{` or `;`, so "https://…", "'/*'" and "src/**\/*.ts" stay code.
 */
const COMMENT_START = /<!--|(?<![^\s{;])\/[/*]/;

/**
 * The lines with HTML (`<!-- -->`, Vue and Svelte templates) and JS (`//`, `/* *\/`, JSX's
 * `{/* *\/}`) comments replaced by a space, line for line, so line numbers do not move. A text
 * quoted in a comment ("<!-- View report link -->", a JSDoc naming the "Export" button) is not
 * where it is rendered from, and must neither be found nor make the real line look duplicated.
 * Line-based, not a parser: a comment marker inside a string, after whitespace (`" //"`), hides
 * the rest of that line (of the lines up to a closing marker, for `/*`) from the search.
 */
function withoutComments(lines: readonly string[]): string[] {
  let end: string | undefined; // "*/" or "-->" while inside a comment that spans lines
  return lines.map((line) => {
    let code = "";
    let rest = line;
    for (;;) {
      if (end !== undefined) {
        const at = rest.indexOf(end);
        if (at < 0) return code;
        rest = ` ${rest.slice(at + end.length)}`;
        end = undefined;
      }
      const start = COMMENT_START.exec(rest);
      if (start === null) return code + rest;
      code += rest.slice(0, start.index);
      if (start[0] === "//") return code;
      end = start[0] === "/*" ? "*/" : "-->";
      rest = rest.slice(start.index + start[0].length);
    }
  });
}

/** Every line matching the pattern, skipping import lines, across the given files in order. */
function hitsIn(files: Sources, pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const [file, lines] of files) {
    lines.forEach((line, i) => {
      if (pattern.test(line) && !/^\s*import\b/.test(line)) hits.push({ file, line: i + 1 });
    });
  }
  return hits;
}

/**
 * The literal and its word runs between numbers and signs: "Active Now +573 +201 since last hour"
 * -> itself, "Active Now", "since last hour". The whole text is tried first.
 *
 * With the element's `html` (only for its own text, never a selection), an element whose text
 * comes from several text pieces (ownPieces: a section header's title, a tooltip, tab labels)
 * keeps only its own, leading text (D9 note 2026-09-29): the whole text; its first piece when that
 * is a child's whole text (`<div>Pending</div>`, closed by a tag, not cut by the capture's
 * trim) and has words (a lone "30" is no literal to look for); and only the word runs inside
 * that first piece. A run from a later piece ("Overdue" in
 * "Pending … All149 Overdue23 Later126") is a descendant's text, often written in its own
 * component or a data entry, and was taken as the element's `text at:`. Silence beats that.
 */
function phrases(text: string, html?: string): string[] {
  const whole = text.replace(/\s+/g, " ").trim();
  if (whole === "") return [];
  const out = [whole];
  const runs: string[] = [];
  for (const run of whole.split(/\s*[+$€%]?[\d.,]+[%kKM]?\s*/)) {
    const phrase = run.trim();
    if (phrase.length >= 2 && phrase !== whole) runs.push(phrase);
  }
  const own = html === undefined ? undefined : ownPieces(html);
  if (own === undefined || own.pieces.length < 2) out.push(...runs);
  else {
    const lead = own.pieces[0];
    if (own.leadIsChild && !lead.endsWith(ELLIPSIS) && /\p{L}{2}/u.test(lead) && whole.startsWith(lead)) out.push(lead);
    out.push(...runs.filter((run) => lead.includes(run)));
  }
  return [...new Set(out)].filter((phrase) => phrase.length <= 80);
}

/** phrases of the text looked up, with the element's HTML when that text is the element's own. */
function phrasesOf(element: ElementInfo, text: string): string[] {
  return phrases(text, htmlOfText(element, text));
}

/** The element's captured HTML when `text` is its own visible text (not a selection), else undefined. */
function htmlOfText(element: ElementInfo, text: string): string | undefined {
  return text === element.text && typeof element.html === "string" && element.html !== "" ? element.html : undefined;
}

/** What html-trim appends where the capture cut a text. */
const ELLIPSIS = "…";

/** Tags, comments and text runs of an element's captured HTML (as html-trim tokenizes it). */
const HTML_TOKEN = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;

/**
 * The element's text pieces in its captured HTML: its non-blank text runs in order, whitespace
 * collapsed, entities decoded. `leadIsChild`: the first piece is followed by a closing tag, so it
 * is a child's whole text (`<div class="title">Pending</div>`), not the start of a sentence
 * with inline markup (`Hello <b>world</b>`).
 */
function ownPieces(html: string): { pieces: string[]; leadIsChild: boolean } {
  const pieces: string[] = [];
  let leadIsChild = false;
  let afterLead = false;
  for (const token of html.match(HTML_TOKEN) ?? []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("<") && token.length > 1) {
      if (afterLead) {
        leadIsChild = token.startsWith("</");
        afterLead = false;
      }
      continue;
    }
    const piece = decodeText(token).replace(/\s+/g, " ").trim();
    if (piece === "") continue;
    afterLead = pieces.length === 0;
    pieces.push(piece);
  }
  return { pieces, leadIsChild };
}

function decodeText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The text as a code literal: bounded by a quote, `>`, `=`, `:` or whitespace before and a quote,
 * `<`, `,` or the line end after, so "Users" does not match "mapUsers". Whitespace inside matches
 * any whitespace (JSX text wraps). `closers`: more characters that may follow it (ENTRY_END).
 */
function literalPattern(text: string, closers = ""): RegExp {
  const body = escapeRegExp(text).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[>"'\`=:]\\s*|\\s)${body}(\\s*[<"'\`,${closers}]|\\s*$)`);
}

/** A value often ends its entry, `badge: 3 }` or `[1, 3]` (rule 3b), where a text has a quote. */
const ENTRY_END = "}\\]";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The data modules the given files (the chain's, then also its definitions') import directly (one
 * hop), read through the reader.
 *
 * An extensionless specifier ("./Dashboard") is tried as ".ts", then ".js" (importCandidates):
 * on a Vite dev server, a component that only exists as "Dashboard.tsx" is still served at
 * "Dashboard.js?raw" (Vite's own resolver falls back through its extension list), so the ".js"
 * guess "succeeds" with the exact bytes of a file already in the chain. That is an alias, not a
 * second file, and must not be added: it would make an unambiguous href look like it hit twice
 * (see resolve.test.ts, "does not mistake a dev server's aliased extension for a second file").
 */
async function importedData(chain: Sources, reader: SourceReader): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const knownContent = new Set([...chain.values()].map((lines) => lines.join("\n")));
  for (const [file, lines] of chain) {
    for (const specifier of importSpecifiers(withoutComments(lines))) {
      const tryCandidates = async (candidates: readonly string[]): Promise<boolean> => {
        for (const candidate of candidates) {
          if (chain.has(candidate) || found.has(candidate)) return true;
          const source = await readSource(reader, candidate);
          if (source === undefined) continue;
          const candidateLines = splitLines(source);
          if (knownContent.has(candidateLines.join("\n"))) continue;
          found.set(candidate, candidateLines);
          knownContent.add(candidateLines.join("\n"));
          return true;
        }
        return false;
      };
      if (!(await tryCandidates(importCandidates(file, specifier, DATA)))) {
        await tryCandidates(await configuredAliasCandidates(specifier, DATA, reader));
      }
    }
  }
  return found;
}

/**
 * `@/` and `~/` mean `src/` in Stage 0's apps (importCandidates). Next.js's default layout has no
 * `src/`: `create-next-app` maps `@/*` to `./*` in tsconfig.json. So when the `src/` guess finds
 * nothing, the project's own `compilerOptions.paths` (tsconfig.json, else jsconfig.json, at the
 * project root, no `extends`) says where the alias points; without such an entry, nothing more is
 * tried. Read only then, so apps whose `src/` files exist never read their tsconfig.
 */
async function configuredAliasCandidates(specifier: string, kind: ImportKind, reader: SourceReader): Promise<string[]> {
  const alias = /^([@~])\//.exec(specifier)?.[1];
  if (alias === undefined) return [];
  const target = (await pathAliases(reader)).get(`${alias}/`);
  if (target === undefined || target === "src/") return [];
  const base = safePath(`${target}${specifier.slice(2)}`);
  return base === undefined ? [] : candidatesFor(base, kind);
}

/** `compilerOptions.paths` entries of the form "X/*": ["Y/*"], as "X/" -> project-relative "Y/" ("" for the root). */
async function pathAliases(reader: SourceReader): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();
  const text = (await readSource(reader, "tsconfig.json")) ?? (await readSource(reader, "jsconfig.json"));
  if (text === undefined) return aliases;
  let config: unknown;
  try {
    config = JSON.parse(jsonc(text));
  } catch {
    return aliases;
  }
  const options = (config as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null)?.compilerOptions;
  const paths = options?.paths;
  if (typeof paths !== "object" || paths === null) return aliases;
  const baseUrl = typeof options?.baseUrl === "string" ? options.baseUrl : ".";
  for (const [key, targets] of Object.entries(paths as Record<string, unknown>)) {
    const first = Array.isArray(targets) ? targets[0] : undefined;
    if (!key.endsWith("/*") || typeof first !== "string" || !first.endsWith("/*")) continue;
    const joined = `${baseUrl}/${first.slice(0, -1)}`.replace(/\\/g, "/").replace(/\/+/g, "/");
    const target = joined.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (target.some((segment) => segment === "..")) continue;
    aliases.set(key.slice(0, -1), target.length === 0 ? "" : `${target.join("/")}/`);
  }
  return aliases;
}

/** tsconfig's JSON with comments and trailing commas, as plain JSON (strings are left alone). */
function jsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const end = /"(?:[^"\\\n]|\\.)*"/y;
      end.lastIndex = i;
      const string = end.exec(text);
      if (string === null) return out + text.slice(i);
      out += string[0];
      i += string[0].length - 1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function importSpecifiers(lines: readonly string[]): string[] {
  const specifiers: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Files an import may point at, in the order to try: relative specifiers, plus the "@/" and "~/"
 * (src/) and "$lib" (src/lib) aliases Stage 0 followed. Bare package imports are never followed.
 * An import with an extension is followed only to a file of that kind (`kind.accept`); one
 * without is tried with each of `kind.probe`, then as an index file ("./nav" -> "nav.ts",
 * "nav.js", "nav/index.ts", "nav/index.js" for data).
 */
function importCandidates(from: string, specifier: string, kind: ImportKind): string[] {
  let base: string | undefined;
  if (specifier.startsWith(".")) base = joinPath(from, specifier);
  else if (/^[@~]\//.test(specifier)) base = `src/${specifier.slice(2)}`;
  else if (specifier === "$lib" || specifier.startsWith("$lib/")) base = `src/lib${specifier.slice(4)}`;
  const safe = base === undefined ? undefined : safePath(base);
  return safe === undefined ? [] : candidatesFor(safe, kind);
}

/** The files a resolved, safe import base may be: itself with an accepted extension, or probed. */
function candidatesFor(safe: string, kind: ImportKind): string[] {
  const extension = /\.([a-z\d]+)$/i.exec(safe.slice(safe.lastIndexOf("/") + 1))?.[1]?.toLowerCase();
  if (extension === undefined) return [...kind.probe.map((ext) => `${safe}.${ext}`), ...kind.probe.map((ext) => `${safe}/index.${ext}`)];
  return kind.accept.has(extension) && !safe.endsWith(".d.ts") ? [safe] : [];
}

/**
 * The chain's files plus the files that define its components (resolveElement, rule 4), the
 * element's own component first: `element.component.file` when dev data gives it (Vue's `__file`,
 * Svelte's loc, React up to 18), then, for each chain frame naming a component, the file its
 * import in that frame's file points at (specifierOf, importCandidates), through one re-export
 * of an index file ("$lib", "./components"). A library component (bare import) and a component
 * not imported where it is used (declared in that same file, registered globally) add nothing.
 * A file already in the chain is not added twice, nor one whose content is a chain file's (a dev
 * server's alias, see importedData).
 */
async function withDefinitions(element: ElementInfo, chain: Sources, reader: SourceReader): Promise<Map<string, string[]>> {
  const definitions = new Map<string, string[]>();
  const knownContent = new Set([...chain.values()].map((lines) => lines.join("\n")));
  const read = async (candidates: readonly string[]): Promise<[string, string[]] | undefined> => {
    for (const candidate of candidates) {
      const known = chain.get(candidate) ?? definitions.get(candidate);
      if (known !== undefined) return [candidate, known];
      const source = await readSource(reader, candidate);
      if (source !== undefined) return [candidate, splitLines(source)];
    }
    return undefined;
  };
  const add = (definition: [string, string[]] | undefined): void => {
    if (definition === undefined || chain.has(definition[0]) || definitions.has(definition[0])) return;
    const content = definition[1].join("\n");
    if (knownContent.has(content)) return;
    knownContent.add(content);
    definitions.set(...definition);
  };

  const own = typeof element.component?.file === "string" ? safePath(cleanPath(element.component.file)) : undefined;
  if (own !== undefined && !isLibraryPath(element.component?.file as string)) add(await read([own]));
  for (const { component: name, file } of codeChain(element)) {
    const lines = chain.get(file);
    const specifier = name === undefined || lines === undefined ? undefined : specifierOf(name, lines, "import");
    if (name === undefined || specifier === undefined) continue;
    const resolveImport = async (from: string, spec: string) =>
      (await read(importCandidates(from, spec, COMPONENT))) ?? (await read(await configuredAliasCandidates(spec, COMPONENT, reader)));
    let definition = await resolveImport(file, specifier);
    const reexport = definition === undefined ? undefined : specifierOf(name, definition[1], "export");
    if (definition !== undefined && reexport !== undefined) {
      definition = (await resolveImport(definition[0], reexport)) ?? definition;
    }
    add(definition);
  }
  for (const candidates of templateIncludes(element, chain)) add(await read(candidates));
  return new Map([...definitions, ...chain]);
}

/** `{% include "pim/partials/status.html" %}` (Django, Jinja), as codeLines leaves it. */
const INCLUDE = /[{<]%-?\s*include\s+["']([^"'\s]+)["']/g;

/**
 * Rule 4 for templates: the files a chain template includes by a literal name, as candidate
 * paths per include. A name is looked up in the template folders the chain itself shows (its
 * file minus its name: "templates/" for `templates/pim/list.html` named "pim/list.html"), then in
 * "templates/" and in the app folder its first segment names ("pim/templates/pim/…", Django's
 * APP_DIRS). An include rendered by pointcast-django is already a chain frame when it holds the
 * element; this finds the text of one whose output is not HTML (a label, a status word), which
 * gets no markers. `{% extends %}` adds nothing: the parent's markers already put it in the chain.
 */
function templateIncludes(element: ElementInfo, chain: Sources): string[][] {
  const frames = codeChain(element).filter((frame) => isTemplateFile(frame.file));
  const roots = new Set<string>();
  for (const { component, file } of frames) {
    if (component !== undefined && file.endsWith(`/${component}`)) roots.add(file.slice(0, -component.length));
  }
  roots.add("templates/");
  const includes: string[][] = [];
  for (const { file } of frames) {
    const lines = chain.get(file);
    if (lines === undefined) continue;
    for (const [, name] of codeLines(file, lines).join("\n").matchAll(INCLUDE)) {
      const app = name.includes("/") ? [`${name.split("/")[0]}/templates/${name}`] : [];
      const paths = [...[...roots].map((root) => `${root}${name}`), ...app];
      includes.push([...new Set(paths.flatMap((path) => safePath(path) ?? []))]);
    }
  }
  return includes;
}

/** `import A from "…"`, `import { B, C as D } from "…"`, `import A, { B } from "…"`, `export { … } from "…"`. */
const BINDINGS = /\b(import|export)\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;

/**
 * Where `name` comes from in a file: the specifier of the import (or, with "export", the
 * re-export: `export { default as More } from './More.svelte'`) that binds that name. Else the
 * first such statement whose file is called `name`: Vue and Svelte name a component after its
 * file, whatever it is imported as (`import RevenueUpdates from './cards/RevenueReport.vue'`).
 */
function specifierOf(name: string, lines: readonly string[], statement: "import" | "export"): string | undefined {
  let byFile: string | undefined;
  for (const [, kind, first, braced, specifier] of withoutComments(lines).join("\n").matchAll(BINDINGS)) {
    if (kind !== statement) continue;
    const names = [first, ...(braced ?? "").split(",").map((binding) => binding.trim().split(/\s+as\s+/).pop())];
    if (names.includes(name)) return specifier;
    if (byFile === undefined && specifier.split("/").pop()?.replace(/\.[^.]+$/, "") === name) byFile = specifier;
  }
  return byFile;
}

/** "src/a/b.ts" + "../c" -> "src/c"; undefined when the specifier climbs out of the project. */
function joinPath(from: string, specifier: string): string | undefined {
  const parts = from.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}
