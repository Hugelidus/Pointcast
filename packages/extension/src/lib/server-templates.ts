import type { CodeFrame, ComponentInfo } from "@pointcast/core";
import { parseComponentInfo, parseRenderedBy, type FrameworkInfo } from "./component-bridge";

/**
 * Code chain for server-rendered templates (D9 note 2026-09-28): the dev-only comment markers
 * that `pointcast-django` (integrations/django) writes around each template it renders:
 *
 *   <!-- pointcast:begin file="templates/pim/partials/row.html" name="pim/partials/row.html" -->
 *   …the template's output…
 *   <!-- pointcast:end file="templates/pim/partials/row.html" -->
 *
 * The templates that enclose an element are the begin markers before it in document order whose
 * end marker comes after it: a stack over the comments that precede it. Comments are in the DOM,
 * so the isolated-world content script reads them directly; no MAIN-world bridge is needed.
 *
 * HTMX: a partial swapped into the page carries its own markers (the server wraps a partial the
 * same way as a page), so the stack sees them wherever the swap put them. A swap can also remove
 * a begin or an end marker of the old content: an end marker names its file and closes the
 * innermost open marker of that file, and everything opened after it, so a begin left without
 * its end cannot outlive the template around it; an end without a begin is ignored.
 */

/** The framework name on `ElementInfo.component` for a chain read from these markers. */
export const TEMPLATE_FRAMEWORK = "django";

/** Comments read at most before the element: a pathological page stays cheap. */
const MAX_COMMENTS = 20_000;

const MAX_FRAMES = 3;

const MARKER = /^\s*pointcast:(begin|end)\s+file="([^"]*)"(?:\s+name="([^"]*)")?\s*$/;

interface OpenTemplate {
  file: string;
  name?: string;
}

/** A marker comment's parts, or undefined for any other comment. */
export function parseTemplateMarker(data: string): { kind: "begin" | "end"; file: string; name?: string } | undefined {
  const match = MARKER.exec(data);
  if (match === null || match[2] === "") return undefined;
  const [, kind, file, name] = match;
  return { kind: kind as "begin" | "end", file, ...(name ? { name } : {}) };
}

/**
 * The templates enclosing `el`, innermost first, with consecutive frames of the same file
 * collapsed (a template that wraps the whole partial it includes, an HTMX outerHTML swap that
 * nests a partial's markers in the old ones), at most 3. Empty when the page has no markers.
 */
export function enclosingTemplates(el: Element): OpenTemplate[] {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(doc, 0x80 /* NodeFilter.SHOW_COMMENT */);
  const open: OpenTemplate[] = [];
  let seen = 0;
  for (let node = walker.nextNode(); node !== null && seen < MAX_COMMENTS; node = walker.nextNode(), seen++) {
    // Stop at the first comment after the element's start: inside it or after it.
    if (el.compareDocumentPosition(node) & 0x04 /* DOCUMENT_POSITION_FOLLOWING */) break;
    const marker = parseTemplateMarker((node as Comment).data);
    if (marker === undefined) continue;
    if (marker.kind === "begin") {
      open.push({ file: marker.file, ...(marker.name ? { name: marker.name } : {}) });
      continue;
    }
    const at = open.map((template) => template.file).lastIndexOf(marker.file);
    if (at >= 0) open.length = at;
  }
  const frames: OpenTemplate[] = [];
  for (const template of open.reverse()) {
    if (frames.length > 0 && frames[frames.length - 1].file === template.file) continue;
    frames.push(template);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

/**
 * `ElementInfo.component` and `renderedBy` from the template markers around `el`: each template
 * as a frame `{ file, component: <template name> }`, and the innermost one as the component,
 * `framework: "django"`. The markers are page content, so they go through the same parsers as
 * the framework bridge's answer (bounded sizes, project-relative paths, D8). Empty without markers.
 */
export function templateInfo(el: Element): FrameworkInfo {
  const templates = enclosingTemplates(el);
  const renderedBy = parseRenderedBy(templates.map(({ file, name }) => ({ file, ...(name ? { component: name } : {}) })));
  if (renderedBy === undefined || renderedBy.length === 0) return {};
  const innermost: CodeFrame = renderedBy[0];
  const component: ComponentInfo | undefined = parseComponentInfo({
    framework: TEMPLATE_FRAMEWORK,
    name: innermost.component,
    file: innermost.file,
  });
  return { renderedBy, ...(component !== undefined ? { component } : {}) };
}

/**
 * The framework chain when the page's dev data gives one, else the template markers' chain. A
 * framework component without a chain (an island with no renderedBy) is kept as the component.
 */
export function withTemplateChain(framework: FrameworkInfo, el: Element): FrameworkInfo {
  if (framework.renderedBy !== undefined) return framework;
  const templates = templateInfo(el);
  if (templates.renderedBy === undefined) return framework;
  const component = framework.component ?? templates.component;
  return { renderedBy: templates.renderedBy, ...(component !== undefined ? { component } : {}) };
}
