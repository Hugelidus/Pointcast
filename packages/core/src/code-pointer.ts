import { codeSpan, escapeMarkdown, oneLine, truncate } from "./markdown";
import { cleanPath, codeChain, isLibraryPath, type ChainFrame } from "./resolve/chain";
import { MAX_SNIPPET_CHARS } from "./resolve/resolve";
import type { ElementInfo, ResolvedLocation, ShownByLocation } from "./schema";

/**
 * The code pointer lines of one element, without list markers: the chain Stage 0 tested
 * ("P-chain-repo", docs/eval/stage0-code-pointer-2026-09-27.md) and the resolved locations.
 *
 *   code: `<a>` inside `src/lib/More.svelte:18` ← `<More>` at `src/lib/ChartWidget.svelte:27` ← …
 *   text at: `src/lib/ChartWidget.svelte:27`
 *
 * then `shown by: file:line` when the resolver found the line that renders the value's key
 * (ElementInfo.shownBy). Frames go innermost first, from the element's own instance outwards: `<Tag> at file:line`, or
 * `in file` when the framework gives no line (Vue); a library component is named by its package
 * ("flowbite-svelte `<TabItem>`"), never by its node_modules path. The first frame says "inside"
 * instead of "at" when it is the element's own tag in a shared component: the resolver found the
 * element's literal outside that file (at an instance further out, or in a data file), so that
 * file renders every instance and is not the one to edit.
 *
 * Used by the classic appendix and the requests format's DOM-first layout, which show no snippets.
 * [] without renderedBy and resolved: sessions recorded before them render exactly as before.
 */
export function codePointerLines(element: ElementInfo): string[] {
  const chain = codeChain(element);
  const resolved = resolvedLocations(element);
  const lines: string[] = [];
  if (chain.length > 0) {
    const shared = chain[0].host && literalElsewhere(chain, resolved);
    lines.push(`code: ${chain.map((frame, i) => frameText(frame, element.tag, i === 0 && shared)).join(" ← ")}`);
  }
  // cleanPath (D8, as for component and source paths): a hand-edited session still renders safely.
  for (const location of resolved) {
    lines.push(`${locationLabel(location.kind)} at: ${codeSpan(`${cleanPath(location.file)}:${location.line}`)}`);
  }
  const shown = shownByLocation(element);
  if (shown !== undefined) lines.push(`shown by: ${codeSpan(`${cleanPath(shown.file)}:${shown.line}`)}`);
  return lines;
}

/**
 * The code-first layout (requests format, the default): the same chain and locations, each
 * labelled by what it is to the element, so the agent sees which code to open before the DOM.
 *
 *   used at: `src/lib/ChartWidget.svelte:27` — `<More title="Sales Report" href="#top" />`
 *   defined in: `src/lib/More.svelte` (shared — do not change it unless asked)
 *   text at: `src/lib/ChartWidget.svelte:27` (same as used at)
 *   within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`
 *
 * - used at: the innermost instance the chain names, where it is written, with its source line
 *   when the resolver read it (else its name). When the first frame is the element's own tag
 *   (Svelte's loc), or an unnamed instance whose literal the resolver found in another file, that
 *   frame is inside a component's definition, so the next frame is the instance.
 * - defined in: that definition's file, marked shared only on that evidence (the literal is
 *   written elsewhere, so the file renders every instance: Stage 0's `nav-group.tsx` error);
 *   for a library component, its package.
 * - template (instead of used at): for a chain read from pointcast-django's markers, the
 *   innermost template, where the element's markup is written (D9 note 2026-09-28).
 * - text at / data at: the resolved locations, with their source line.
 * - shown by: the line that renders that value's key (`<td>{order.customer}</td>` for
 *   `customer: "Marco Peña"`), when the resolver found exactly one (ElementInfo.shownBy).
 * - within: the rest of the chain, outwards, in Stage 0's wording.
 *
 * [] without renderedBy and resolved: such elements keep the DOM-first layout.
 */
export function codeFirstLines(element: ElementInfo): string[] {
  const chain = codeChain(element);
  const resolved = resolvedLocations(element);
  const first = chain[0];
  const shared = first !== undefined && (first.host || first.component === undefined) && literalElsewhere(chain, resolved);
  // A chain of just the element's own tag (a React element written straight in a Next.js page or
  // layout) is where it is used: there is no instance further out to send the agent to.
  const definition = first !== undefined && chain.length > 1 && (first.host || shared) ? first : undefined;
  const usedIndex = definition === undefined ? 0 : 1;
  const used: ChainFrame | undefined = chain[usedIndex];
  // Defense in depth (D8): the resolver keeps no snippet for a sensitive element; a hand-edited session may.
  const quote = (snippet: unknown): string | undefined =>
    element.sensitive !== true && typeof snippet === "string" && snippet.trim() !== "" ? snippetSpan(snippet) : undefined;

  const lines: string[] = [];
  if (used !== undefined) {
    const name = used.component === undefined || used.template ? undefined : codeSpan(`<${used.component}>`);
    const what = quote(used.snippet) ?? name;
    // A server template (pointcast-django) is where the element's markup is written, not an instance.
    lines.push(`${used.template ? "template" : "used at"}: ${codeSpan(where(used))}${what === undefined ? "" : ` — ${what}`}`);
  }
  if (definition !== undefined) {
    lines.push(`defined in: ${codeSpan(definition.file)}${shared ? " (shared — do not change it unless asked)" : ""}`);
  } else if (used?.pkg !== undefined) {
    lines.push(`defined in: package ${codeSpan(used.pkg)}`);
  } else {
    const file = componentDefinition(element, used);
    if (file !== undefined) {
      const elsewhere = resolved.length > 0 && resolved.every((location) => cleanPath(location.file) !== file);
      lines.push(`defined in: ${codeSpan(file)}${elsewhere ? " (shared — do not change it unless asked)" : ""}`);
    }
  }
  for (const location of resolved) {
    const file = cleanPath(location.file);
    const same = used?.line !== undefined && used.file === file && used.line === location.line;
    const snippet = quote(location.snippet);
    const tail = same ? " (same as used at)" : snippet === undefined ? "" : ` — ${snippet}`;
    lines.push(`${locationLabel(location.kind)} at: ${codeSpan(`${file}:${location.line}`)}${tail}`);
  }
  const shown = shownByLocation(element);
  if (shown !== undefined) {
    const file = cleanPath(shown.file);
    const same = used?.line !== undefined && used.file === file && used.line === shown.line;
    const snippet = quote(shown.snippet);
    lines.push(`shown by: ${codeSpan(`${file}:${shown.line}`)}${same ? " (same as used at)" : snippet === undefined ? "" : ` — ${snippet}`}`);
  }
  const outer = chain.slice(usedIndex + 1);
  if (outer.length > 0) lines.push(`within: ${outer.map((frame) => frameText(frame, element.tag, false)).join(" ← ")}`);
  return lines;
}

/**
 * True when the resolver found the element's literal, and only outside the first frame's file:
 * that file renders every instance (it is shared), and the instance is the next frame.
 */
function literalElsewhere(chain: readonly ChainFrame[], resolved: readonly ResolvedLocation[]): boolean {
  return chain.length > 1 && resolved.length > 0 && resolved.every((location) => cleanPath(location.file) !== chain[0].file);
}

/**
 * The file defining the `used at` component, from the element's own component (D9 note
 * 2026-09-28, pass 2): when `element.component` names that same component and gives its app file
 * (Vue's `__file`, the file of a React 19 element's own JSX), the definition is known even when no
 * chain frame is written in it. Vue's instances are frames where they are used, so «+$39.00»-like
 * elements (the same text twice in one component) still say which component file draws them.
 * Undefined for a library file, a template, or another component's file.
 */
function componentDefinition(element: ElementInfo, used: ChainFrame | undefined): string | undefined {
  const own = element.component;
  if (used === undefined || used.host || used.template || used.component === undefined) return undefined;
  if (typeof own !== "object" || own === null || own.name !== used.component || own.framework === "django") return undefined;
  if (typeof own.file !== "string" || own.file === "" || isLibraryPath(own.file)) return undefined;
  const file = cleanPath(own.file);
  return file === "" || file === used.file ? undefined : file;
}

/** "text", "data", "class", "id": the line's name (`class at:`); anything else reads as "text". */
function locationLabel(kind: unknown): string {
  return kind === "data" || kind === "class" || kind === "id" ? kind : "text";
}

function resolvedLocations(element: ElementInfo): ResolvedLocation[] {
  return Array.isArray(element.resolved) ? element.resolved.filter(isLocation) : [];
}

/** `element.shownBy` when it is a usable location (a hand-edited session may hold anything). */
function shownByLocation(element: ElementInfo): ShownByLocation | undefined {
  const shown: unknown = element.shownBy;
  return isLocation(shown) ? (shown as unknown as ShownByLocation) : undefined;
}

function where(frame: ChainFrame): string {
  return frame.line === undefined ? frame.file : `${frame.file}:${frame.line}`;
}

/** A source line in a code span: one line, backtick-safe, at most MAX_SNIPPET_CHARS (hand-edited sessions too). */
function snippetSpan(snippet: string): string {
  return codeSpan(truncate(oneLine(snippet), MAX_SNIPPET_CHARS));
}

/**
 * "flowbite-svelte `<TabItem>` at `src/lib/Stats.svelte:55`", "`<p>` in `src/X.vue`", and
 * "template `templates/pim/list.html`" for a server template (its name is in its path).
 */
function frameText(frame: ChainFrame, tag: string, inside: boolean): string {
  if (frame.template) return `template ${codeSpan(where(frame))}`;
  const name = frame.host ? `<${tag}>` : frame.component === undefined ? undefined : `<${frame.component}>`;
  const what = [
    ...(frame.pkg === undefined ? [] : [escapeMarkdown(frame.pkg)]),
    name === undefined ? "component" : codeSpan(name),
  ].join(" ");
  return `${what} ${inside ? "inside" : frame.line === undefined ? "in" : "at"} ${codeSpan(where(frame))}`;
}

function isLocation(value: unknown): value is ResolvedLocation {
  const location = value as ResolvedLocation;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof location.file === "string" &&
    location.file !== "" &&
    Number.isInteger(location.line) &&
    location.line > 0
  );
}
