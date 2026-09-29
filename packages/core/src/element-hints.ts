import { elementText, fullSource } from "./describe";
import { trimHtml } from "./html-trim";
import { codeSpan, escapeMarkdown, oneLine } from "./markdown";
import { projectRelativePath } from "./paths";
import { isLibraryPath, libraryPackage } from "./resolve/chain";
import type { ElementInfo } from "./schema";
import { isUtilityClass } from "./utility-classes";

/** Longest label worth quoting as a grep key; longer ones are prose, not identifiers. */
const LABEL_BUDGET = 60;

/**
 * Attributes of the element's own opening tag (the first tag of `html`), names lowercased.
 * The HTML is already sanitized and trimmed at capture (D5), so a regex over one tag is enough.
 */
export function rootAttributes(html: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // The name ends where a space, "/" or ">" follows it, so the name and the attributes can never
  // split the same characters between them: linear on any input (CodeQL js/polynomial-redos).
  const tag = /^\s*<[a-zA-Z][\w-]*(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html);
  if (!tag) return attributes;
  const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  for (const match of tag[1].matchAll(ATTRIBUTE)) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * CSS-module class, as Next.js and css-loader name them: "Toolbar_export__3xKz1" is class
 * "export" of Toolbar.module.css, so "Toolbar" is the component to look for and
 * "Toolbar_export" the stable, greppable part (the hash changes between builds).
 */
const CSS_MODULE = /^([A-Z][A-Za-z\d]*)_([A-Za-z][\w-]*?)__[\w-]{3,}$/;

/** Generated ids carry no meaning in the source (D3): React ":r1:", library prefixes, UUIDs, long digit runs. */
const GENERATED_ID = /^:|^(radix|headlessui|mui|react-aria)-|\d{4,}|^[\da-f]{8}-[\da-f]{4}-/i;

/**
 * Greppable keys for one element, most specific first, each already rendered as Markdown:
 * id, data-testid, name, label (when it is not the visible text), href, plain classes, CSS
 * module (with its component), dev-mode component, and source location. The visible text is
 * not repeated: the element's descriptor already quotes it.
 */
export function searchHints(element: ElementInfo): string[] {
  const attributes = rootAttributes(element.html);
  const hints: string[] = [];

  const id = attributes.get("id") ?? /#([^\s›«[.#]+)/.exec(lastSegment(element.path))?.[1];
  if (id && !GENERATED_ID.test(id)) hints.push(codeSpan(`#${id}`));
  const testId = attributes.get("data-testid");
  if (testId) hints.push(`data-testid ${codeSpan(testId)}`);
  const name = attributes.get("name");
  if (name) hints.push(`name ${codeSpan(name)}`);
  for (const attribute of ID_DATA_ATTRIBUTES) {
    const value = attributes.get(attribute);
    if (value) hints.push(`${attribute} ${codeSpan(value)}`);
  }
  const label = oneLine(element.label ?? "");
  // The descriptor quotes elementText, which falls back to the label: do not say it twice.
  if (label !== "" && label !== oneLine(elementText(element)) && label.length <= LABEL_BUDGET) {
    hints.push(`label «${escapeMarkdown(label)}»`);
  }
  const href = attributes.get("href");
  if (href) hints.push(`href ${codeSpan(href)}`);

  const { plain, modules } = splitClasses(attributes.get("class") ?? "");
  if (plain.length > 0) hints.push(`class ${codeSpan(plain.join(" "))}`);
  for (const module of modules) {
    hints.push(`CSS module ${codeSpan(module.stable)} (component ${escapeMarkdown(module.component)})`);
  }

  const component = element.component;
  if (component?.name) {
    // pointcast-django's markers name a template, not a component (D9 note 2026-09-28).
    const kind = component.framework === "django" ? "template" : "component";
    const framework = escapeMarkdown(component.framework);
    if (component.file && isLibraryPath(component.file)) {
      // A library component: its node_modules path is no place for an agent to open or edit,
      // so it is named by its package, as the code pointer does (D9), and never by that path.
      const pkg = libraryPackage(component.file);
      hints.push(`${kind} ${codeSpan(component.name)} (${framework}, ${pkg === undefined ? "library" : `package ${codeSpan(pkg)}`})`);
    } else {
      const line = component.line === undefined ? "" : `:${component.line}`;
      // Defense in depth (D8): normalizes to a project-relative path even for a session recorded
      // before capture did it, since component.file is dev-build data the extension only reads.
      const where = component.file ? ` in ${codeSpan(`${projectRelativePath(component.file)}${line}`)}` : "";
      hints.push(`${kind} ${codeSpan(component.name)} (${framework})${where}`);
    }
  }
  // A source attribute pointing into a library says nothing the agent can act on (see above).
  if (element.source && !isLibraryPath(element.source.file)) {
    const distance = element.source.distance;
    hints.push(
      `source ${codeSpan(fullSource(element.source))}${distance > 0 ? ` (ancestor +${distance})` : ""}`,
    );
  }
  return hints;
}

/**
 * Classes split into plain ones and CSS modules. Hashed and utility noise is dropped at capture;
 * utilities are dropped here too (isUtilityClass), for classes capture did not yet know as
 * utilities (`transition-all`, `ring-sidebar-ring` in sessions before 2026-09-28): a generic
 * class is no grep key. Semantic classes, CSS modules, ids, hrefs and data-* stay.
 */
function splitClasses(value: string): {
  plain: string[];
  modules: { stable: string; component: string }[];
} {
  const plain: string[] = [];
  const modules: { stable: string; component: string }[] = [];
  for (const name of value.split(/\s+/).filter(Boolean)) {
    const module = CSS_MODULE.exec(name);
    if (module) modules.push({ stable: `${module[1]}_${module[2]}`, component: module[1] });
    else if (!isUtilityClass(name)) plain.push(name);
  }
  return { plain, modules };
}

/** Values that say nothing in a one-line style summary. */
const EMPTY_STYLE = /^(0px|auto|normal|none)$/;

/**
 * "`color: rgb(17, 24, 39); font-size: 14px`", skipping zero/auto values; undefined when none remain.
 * Pixel lengths are rounded to whole pixels (`596.844px` -> `597px`): the fraction is layout
 * noise, never something to ask for. Colors are kept exactly as captured ("make it green").
 */
export function stylesLine(styles: Record<string, string> | undefined): string | undefined {
  const parts = Object.entries(styles ?? {})
    .filter(([, value]) => !EMPTY_STYLE.test(value.trim()))
    .map(([property, value]) => `${property}: ${roundPixels(oneLine(value))}`);
  return parts.length === 0 ? undefined : codeSpan(parts.join("; "));
}

/** `596.844px` -> `597px`, `8.5px 16px` -> `9px 16px`, in any value; other units and numbers stay. */
export function roundPixels(value: string): string {
  return value.replace(/(-?\d*\.\d+)px(?![\w-])/g, (_match, number: string) => `${Math.round(Number(number)) || 0}px`);
}

/** Attributes whose information searchHints already gives (or that carry none). */
const SHOWN_ATTRIBUTES = new Set(["id", "data-testid", "name", "href", "class", "type", "aria-label"]);

/**
 * Identifier data attributes the extension keeps on an SVG item (`<g data-id="limites">`, D7 note
 * 2026-09-29); the only elements whose html carries them, so HTML elements' hints are unchanged.
 */
export const ID_DATA_ATTRIBUTES: readonly string[] = ["data-id", "data-key", "data-node", "data-node-id", "data-name", "data-slug"];
for (const name of ID_DATA_ATTRIBUTES) SHOWN_ATTRIBUTES.add(name);

/**
 * True when the HTML tells the agent something the hints do not: an attribute we do not list
 * (role, aria-expanded, title…) or child elements. An icon (`<svg/>`) alone does not count, nor
 * an SVG element's `<title>` child that is its label.
 * Why: `<th>Quantity</th>` next to «Quantity» is pure repetition, and big containers are what
 * made the classic appendix expensive.
 */
export function htmlAddsInformation(element: ElementInfo): boolean {
  if (element.html === "") return false;
  const shown = new Set(SHOWN_ATTRIBUTES);
  if (element.source) shown.add(element.source.attribute);
  for (const name of rootAttributes(element.html).keys()) {
    if (!shown.has(name)) return true;
  }
  const inner = element.html.replace(/^\s*<(?:[^>"']|"[^"]*"|'[^']*')*>/, "");
  // An SVG shape's own <title> is its label, which the descriptor already quotes.
  const label = oneLine(element.label ?? "");
  const withoutTitle = inner.replace(/<title>([^<]*)<\/title>/g, (title, text: string) =>
    label !== "" && oneLine(decodeEntities(text)) === label ? "" : title,
  );
  return /<[a-zA-Z]/.test(withoutTitle.replace(/<svg\b[^>]*\/>/gi, ""));
}

/** One line of HTML, trimmed structurally (D5), for a code span. */
export function htmlSnippet(html: string, budget: number): string {
  return trimHtml(oneLine(html), budget);
}

/** Last segment of a readable path ("main › section#orders › th[3]" -> "th[3]"). */
export function lastSegment(path: string): string {
  const segments = path.split(" › ");
  return segments[segments.length - 1] ?? "";
}
