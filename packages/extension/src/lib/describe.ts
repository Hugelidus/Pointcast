import { isShortValue, projectRelativePath, type ElementInfo, type SourceRef } from "@pointcast/core";
import { requestFrameworkInfo } from "./component-bridge";
import { composedParent, isShadowRoot } from "./dom";
import { isGeneratedId } from "./noise";
import { DEFAULT_DESCRIBE_OPTIONS, type DescribeOptions } from "./options";
import { redactPersonalText } from "./personal";
import { isSensitive, sanitizeHtml } from "./sanitize";
import { buildComposedSelector } from "./selector";
import { collapseWhitespace, truncate, visibleText } from "./text";

const MAX_TEXT = 200;
const MAX_PATH_LABEL = 40;
const MAX_PATH_SEGMENTS = 10;

/**
 * Ancestors worth naming in the readable path: page landmarks plus the structure that says
 * where something sits in a list or table (row 3, column 5).
 */
const PATH_TAGS = new Set([
  "main", "nav", "header", "footer", "aside", "section", "article", "form", "dialog", "fieldset",
  "details", "figure", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "menu", "li",
]);

function stableId(el: Element): string | undefined {
  const id = el.getAttribute("id");
  return id !== null && !isGeneratedId(id) ? id : undefined;
}

// ---------------------------------------------------------------------------------- label

function textOf(el: Element, options: DescribeOptions, except?: Element): string {
  return isSensitive(el, options) ? "" : visibleText(el, options, MAX_TEXT, except);
}

/** Text of the elements `el`'s aria-labelledby points at ("" when none). */
function labelledByText(el: Element, options: DescribeOptions): string {
  const ids = el.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  // ids are scoped to the element's tree: the shadow root when it sits inside one.
  const root = el.getRootNode() as Document | ShadowRoot;
  const scope = typeof root.getElementById === "function" ? root : el.ownerDocument;
  return ids
    .map((id) => scope.getElementById(id))
    .map((ref) => (ref === null ? "" : textOf(ref, options)))
    .join(" ");
}

/**
 * Accessible-name sources in the order a screen reader would use them (roughly).
 *
 * PRIVACY (D8): aria-label/title/placeholder/alt are read straight off `el`'s own attributes,
 * and real apps sometimes set them to the field's current value (a masked-value tooltip, an
 * accessible name built from what was typed). aria-labelledby and `labels` are safe as-is
 * because they resolve to *another* element's text through `textOf`, which already blanks it
 * when that element is sensitive — but el's own attributes carry no such check by themselves,
 * so a sensitive el must skip them here.
 */
function labelOf(el: Element, options: DescribeOptions): string | undefined {
  const sensitive = isSensitive(el, options);
  const candidates: (() => string | null | undefined)[] = [
    () => (sensitive ? undefined : el.getAttribute("aria-label")),
    () => labelledByText(el, options),
    () => {
      // `labels` exists on labelable elements only (input, select, textarea, button, …).
      const labels = (el as Partial<HTMLInputElement>).labels;
      return labels ? Array.from(labels, (label) => textOf(label, options)).join(" ") : undefined;
    },
    () => (sensitive ? undefined : el.getAttribute("title")),
    () => (sensitive ? undefined : el.getAttribute("placeholder")),
    () => (sensitive ? undefined : el.getAttribute("alt")),
  ];
  for (const candidate of candidates) {
    const value = collapseWhitespace(candidate() ?? "");
    if (value !== "") return truncate(value, MAX_TEXT);
  }
  return undefined;
}

// ----------------------------------------------------------------------------------- hint

/** Header text of the column `cell` is in, from the table's first header row. */
function columnHeader(cell: HTMLTableCellElement, options: DescribeOptions): string | undefined {
  const table = cell.closest("table");
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (table === null || row === null) return undefined;
  const headerRow =
    table.tHead?.rows[0] ?? Array.from(table.rows).find((r) => r.querySelector(":scope > th") !== null);
  if (headerRow === undefined || headerRow === row) return undefined;

  // Column position counts colspans, so it survives merged header cells.
  let column = 0;
  for (const previous of Array.from(row.cells)) {
    if (previous === cell) break;
    column += previous.colSpan;
  }
  let start = 0;
  for (const header of Array.from(headerRow.cells)) {
    if (column < start + header.colSpan) return textOf(header, options) || undefined;
    start += header.colSpan;
  }
  return undefined;
}

function isSubmitButton(el: Element): boolean {
  const type = el.getAttribute("type")?.toLowerCase();
  if (el.localName === "button") return type === null || type === undefined || type === "submit";
  return el.localName === "input" && (type === "submit" || type === "image");
}

/** Which form a submit button submits, as a grep key: form#id, form[name=…] or form«label». */
function formHint(button: Element, options: DescribeOptions): string | undefined {
  const form = (button as HTMLButtonElement).form ?? button.closest("form");
  if (form === null) return undefined;
  const id = stableId(form);
  if (id !== undefined) return `form#${id}`;
  const name = form.getAttribute("name");
  if (name) return `form[name=${name}]`;
  // PRIVACY (D8): a form marked (or nested in) data-sensitive could have its aria-label set to
  // something built from its content; skip straight to the bare fallback instead.
  const label = isSensitive(form, options) ? null : form.getAttribute("aria-label");
  return label ? `form«${truncate(label, MAX_PATH_LABEL)}»` : "form";
}

function hintOf(el: Element, options: DescribeOptions): string | undefined {
  if (el.localName === "td" || el.localName === "th") return columnHeader(el as HTMLTableCellElement, options);
  if (isSubmitButton(el)) return formHint(el, options);
  return undefined;
}

// -------------------------------------------------------------------------------- context

const MAX_CONTEXT = 60;
/** A subtitle longer than this is content, not part of the title. */
const MAX_SUBTITLE = 40;
const HEADINGS = "h1, h2, h3, h4, h5, h6, [role=heading]";
/** How many ancestors up to look for the card or section around an element. */
const MAX_CONTEXT_LEVELS = 8;
/** Above these the heading belongs to the page, not to a card (and the URL already says the page). */
const CONTEXT_STOP_TAGS = new Set(["main", "body", "html"]);
/** A block holding a heading with more elements than this is a card of its own, not a title. */
const MAX_TITLE_BLOCK_ELEMENTS = 25;
/** Node.DOCUMENT_POSITION_FOLLOWING, without relying on the realm's global Node (jsdom tests). */
const FOLLOWING = 4;

/** aria-label or aria-labelledby of a named container (a section, a nav, a dialog…). */
function regionName(el: Element, options: DescribeOptions): string | undefined {
  // PRIVACY (D8): same rule as pathSegment, a sensitive element's aria-label may hold a value.
  if (isSensitive(el, options)) return undefined;
  const name = collapseWhitespace(el.getAttribute("aria-label") ?? "") || collapseWhitespace(labelledByText(el, options));
  if (name === "") return undefined;
  // A tab panel is named by its tab: "Overview tab", so it does not read as a card called
  // "Overview" (shadcn-admin's dashboard has both).
  return el.getAttribute("role") === "tabpanel" ? `${name} tab` : name;
}

/** The child of `container` that holds `node`. */
function blockOf(node: Element, container: Element): Element {
  let block = node;
  while (block.parentElement !== null && block.parentElement !== container) block = block.parentElement;
  return block;
}

/** "$45,385 · Sales this week": a heading and the short line right after it, unless that is `el`'s. */
function titleWithSubtitle(heading: Element, el: Element, options: DescribeOptions): string {
  const title = textOf(heading, options);
  const next = heading.nextElementSibling;
  if (next === null || next.contains(el)) return title;
  const subtitle = textOf(next, options);
  return subtitle !== "" && subtitle.length <= MAX_SUBTITLE ? `${title} · ${subtitle}` : title;
}

/**
 * The first heading of `container` before `child` (the block holding the element) that titles
 * the container. Skipped: a heading in another item of the same list or grid (a sibling block
 * with `child`'s tag and class), and one in a big sibling block (another card). A title comes
 * before what it titles, so headings after the element are never used.
 */
function headingOf(container: Element, child: Element, el: Element, options: DescribeOptions): string | undefined {
  for (const heading of Array.from(container.querySelectorAll(HEADINGS))) {
    if ((heading.compareDocumentPosition(child) & FOLLOWING) === 0) continue;
    const block = blockOf(heading, container);
    const repeated = block.localName === child.localName && block.getAttribute("class") === child.getAttribute("class");
    if (repeated || block.getElementsByTagName("*").length > MAX_TITLE_BLOCK_ELEMENTS) continue;
    const title = titleWithSubtitle(heading, el, options);
    if (title !== "") return title;
  }
  return undefined;
}

/**
 * The title of the card or section around `el` (ElementInfo.context): the name of the nearest
 * named container, or the heading that titles the nearest container that has one. It tells
 * apart two instances of a shared component, e.g. two «Sales Report» links rendered by the same
 * `More` component in two cards, which the text, path and component cannot (eval 2026-09-27).
 * A title that only repeats the element's own text (the element is the heading) is passed over.
 */
function contextOf(el: Element, options: DescribeOptions): string | undefined {
  const own = textOf(el, options);
  let child = el;
  for (let level = 0; level < MAX_CONTEXT_LEVELS; level++) {
    const container = composedParent(child);
    if (container === null || CONTEXT_STOP_TAGS.has(container.localName) || container.getAttribute("role") === "main") {
      return undefined;
    }
    // Across a shadow boundary the host's headings are in another tree: only its name counts.
    const title =
      regionName(container, options) ?? (child.parentElement === container ? headingOf(container, child, el, options) : undefined);
    if (title !== undefined && title !== own) return truncate(title, MAX_CONTEXT);
    child = container;
  }
  return undefined;
}

// ----------------------------------------------------------------------------- item label

/** How many ancestors up to look for the item a short value belongs to. */
const MAX_ITEM_LEVELS = 4;
const ITEM_TAGS = new Set(["li", "button", "label"]);
const ITEM_ROLES = new Set(["listitem", "row", "option", "menuitem", "tab", "treeitem"]);

function isItem(el: Element): boolean {
  const role = el.getAttribute("role");
  return ITEM_TAGS.has(el.localName) || (el.localName === "a" && el.hasAttribute("href")) || (role !== null && ITEM_ROLES.has(role));
}

/** A table row's label, for a value in `cell`: its `th[scope=row]`, else its first other cell. */
function rowLabel(cell: Element, options: DescribeOptions): string {
  const row = cell.parentElement;
  if (row === null || row.localName !== "tr") return "";
  const others = Array.from(row.children).filter((c) => (c.localName === "td" || c.localName === "th") && c !== cell);
  const label = others.find((c) => c.localName === "th" && c.getAttribute("scope") === "row") ?? others[0];
  return label === undefined ? "" : textOf(label, options);
}

/**
 * The label of the item a short value belongs to (ElementInfo.itemLabel): "Messages" for the «3»
 * badge in the Messages link. The nearest list item, link, button, label or item role above the
 * element, read without the element's own text; for a table cell, its row's label, not the whole
 * row. A lone "3" cannot be searched in the code (it is everywhere) nor told apart from the other
 * counters on the page; "the 3 next to Messages" can.
 */
function itemLabelOf(el: Element, text: string, options: DescribeOptions): string | undefined {
  if (!isShortValue(text) || isSensitive(el, options)) return undefined;
  let label = "";
  let current: Element | null = el;
  for (let level = 0; current !== null && level <= MAX_ITEM_LEVELS; level++, current = composedParent(current)) {
    if (current.localName === "td" || current.localName === "th") {
      label = rowLabel(current, options);
      break;
    }
    if (current !== el && isItem(current)) {
      label = textOf(current, options, el);
      break;
    }
  }
  label = collapseWhitespace(label);
  return /\p{L}/u.test(label) ? truncate(label, MAX_CONTEXT) : undefined;
}

// ----------------------------------------------------------------------------------- path

function pathSegment(el: Element, options: DescribeOptions): string {
  const id = stableId(el);
  if (id !== undefined) return `${el.localName}#${id}`;
  // PRIVACY (D8): the path is kept even for sensitive elements, so a sensitive segment (or one
  // inside a sensitive subtree) must not spell out its aria-label — it can hold the value itself
  // (an accessible name built from the field's content), unlike a plain id or class name.
  const label = isSensitive(el, options) ? "" : collapseWhitespace(el.getAttribute("aria-label") ?? "");
  if (label !== "") return `${el.localName}«${truncate(label, MAX_PATH_LABEL)}»`;

  const role = el.getAttribute("role");
  let segment = role ? `${el.localName}[role=${role}]` : el.localName;
  // parentNode, not parentElement: a direct child of a shadow root has siblings too.
  const parent = el.parentNode as ParentNode | null;
  const sameTag = parent === null ? [] : Array.from(parent.children).filter((c) => c.localName === el.localName);
  if (sameTag.length > 1) segment += `[${sameTag.indexOf(el) + 1}]`;
  return segment;
}

function isPathLandmark(el: Element): boolean {
  if (PATH_TAGS.has(el.localName) || stableId(el) !== undefined || el.hasAttribute("aria-label")) return true;
  const role = el.getAttribute("role");
  return role !== null && role !== "presentation" && role !== "none";
}

/** Marks where the path enters a shadow tree: "my-card › #shadow-root › button". */
const SHADOW_BOUNDARY = "#shadow-root";

/**
 * Readable landmark path, e.g. "main › section#orders › table#orders-table › thead › tr › th[3]".
 * Crosses open shadow roots: the host is always named, followed by "#shadow-root", because the
 * boundary tells the agent the element lives inside a web component.
 */
export function readablePath(el: Element, options: DescribeOptions = DEFAULT_DESCRIBE_OPTIONS): string {
  const segments: string[] = [];
  let isHost = false;
  for (let current: Element | null = el; current !== null; ) {
    if (current !== el && (current.localName === "body" || current.localName === "html")) break;
    if (current === el || isHost || isPathLandmark(current)) segments.unshift(pathSegment(current, options));
    isHost = current.parentElement === null && isShadowRoot(current.parentNode);
    if (isHost) segments.unshift(SHADOW_BOUNDARY);
    current = composedParent(current);
  }
  if (segments.length > MAX_PATH_SEGMENTS) {
    // Keep the outermost landmark and the part nearest the element; the middle adds little.
    segments.splice(1, segments.length - MAX_PATH_SEGMENTS + 1, "…");
  }
  return segments.join(" › ");
}

// --------------------------------------------------------------------------------- source

/**
 * Parses "file:line[:col]"; a value without a trailing line number is kept as a file only.
 * A trailing ":tag" is ignored: code-inspector-plugin writes "src/App.vue:12:5:div".
 *
 * `value` is page-controlled input (a `data-source`-style attribute), so the file it names goes
 * through `projectRelativePath` (D8, PRIVACY): a dev-server or build plugin could report an
 * absolute path here just as a framework's own dev data can (framework-main.ts).
 */
function parseSource(value: string, attribute: string, distance: number): SourceRef {
  const match = /^(.+?):(\d+)(?::(\d+))?(?::[A-Za-z][\w.-]*)?$/.exec(value.trim());
  if (match === null) return { file: projectRelativePath(value.trim()), attribute, distance };
  const [, file = "", line, column] = match;
  return {
    file: projectRelativePath(file),
    line: Number(line),
    ...(column === undefined ? {} : { column: Number(column) }),
    attribute,
    distance,
  };
}

/** Source location from the element or its nearest ancestor carrying a source attribute (D9). */
export function findSource(el: Element, sourceAttributes: readonly string[]): SourceRef | undefined {
  let distance = 0;
  for (let current: Element | null = el; current !== null; current = composedParent(current), distance++) {
    for (const attribute of sourceAttributes) {
      const value = current.getAttribute(attribute);
      if (value) return parseSource(value, attribute, distance);
    }
  }
  return undefined;
}

// ------------------------------------------------------------------------------- describe

/**
 * Personal-data redaction over every free-text field (CaptureOptions.redactPersonalData).
 * A selector that changed no longer matches the page, so it stops claiming to be unique.
 */
function redactPersonal(info: ElementInfo): ElementInfo {
  const selector = redactPersonalText(info.selector);
  return {
    ...info,
    text: redactPersonalText(info.text),
    ...(info.label !== undefined ? { label: redactPersonalText(info.label) } : {}),
    ...(info.hint !== undefined ? { hint: redactPersonalText(info.hint) } : {}),
    ...(info.context !== undefined ? { context: redactPersonalText(info.context) } : {}),
    ...(info.itemLabel !== undefined ? { itemLabel: redactPersonalText(info.itemLabel) } : {}),
    selector,
    selectorUnique: info.selectorUnique && selector === info.selector,
    path: redactPersonalText(info.path),
    html: redactPersonalText(info.html),
  };
}

/**
 * Everything the session keeps about one element: grep keys for the agent (text, label, hint,
 * context, itemLabel, path, source, component, renderedBy) and a selector for machines (D3).
 * Already sanitized (D8): sensitive elements keep tag, selector, path and label, with empty text
 * and redacted html.
 */
export function describeElement(el: Element, options: Partial<DescribeOptions> = {}): ElementInfo {
  const settings: DescribeOptions = { ...DEFAULT_DESCRIBE_OPTIONS, ...options };
  const sensitive = isSensitive(el, settings);
  const text = sensitive ? "" : visibleText(el, settings, MAX_TEXT);
  const label = labelOf(el, settings);
  const hint = hintOf(el, settings);
  const context = contextOf(el, settings);
  const itemLabel = itemLabelOf(el, text, settings);
  const { selector, unique } = buildComposedSelector(el, {
    sourceAttributes: settings.sourceAttributes,
    sensitiveAttribute: settings.sensitiveAttribute,
  });
  const source = findSource(el, settings.sourceAttributes);
  // Names and file positions only (component-bridge.ts), so they are kept for sensitive elements too.
  const { component, renderedBy } = requestFrameworkInfo(el);

  const info: ElementInfo = {
    tag: el.localName,
    text,
    // A label equal to the text would only repeat it in the Markdown.
    ...(label !== undefined && label !== text ? { label } : {}),
    ...(hint !== undefined ? { hint } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(itemLabel !== undefined ? { itemLabel } : {}),
    selector,
    selectorUnique: unique,
    path: readablePath(el, settings),
    html: sanitizeHtml(el, settings),
    ...(source !== undefined ? { source } : {}),
    ...(component !== undefined ? { component } : {}),
    ...(renderedBy !== undefined ? { renderedBy } : {}),
    ...(sensitive ? { sensitive: true } : {}),
  };
  return settings.redactPersonalData ? redactPersonal(info) : info;
}
