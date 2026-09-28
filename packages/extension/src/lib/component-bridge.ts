import { isLibraryPath, projectRelativePath, type CodeFrame, type ComponentInfo } from "@pointcast/core";

/**
 * Isolated-world half of the component bridge.
 *
 * Frameworks keep their dev data in JS properties of DOM nodes (__vueParentComponent,
 * __svelte_meta, React fibers). The content script runs in Chrome's isolated world, which shares
 * the DOM but not those properties, so a small MAIN-world script (framework-main.ts) reads them.
 *
 * Protocol, fully synchronous because dispatchEvent runs every listener before it returns:
 * 1. The isolated side removes any stale COMPONENT_ATTRIBUTE from the element and dispatches a
 *    plain `Event(COMPONENT_REQUEST_EVENT, { composed: true })` on it. It does not bubble, so app
 *    listeners on ancestors never see it; composed lets the capture-phase listener on window
 *    receive it from inside shadow roots.
 * 2. The MAIN-world listener takes the element from `composedPath()[0]`, reads the framework
 *    data and, when it finds any, writes it as JSON (a FrameworkInfo) into COMPONENT_ATTRIBUTE.
 * 3. The isolated side reads the attribute, removes it and validates the shape.
 * Strings, not objects, cross the boundary: a CustomEvent's detail object is not shared between
 * worlds. No MAIN-world script (production site, not registered) simply means no attribute.
 */
export const COMPONENT_REQUEST_EVENT = "pointcast:component-request";
export const COMPONENT_ATTRIBUTE = "data-pointcast-component";
/**
 * The asynchronous request (Next.js, D9 note 2026-09-28): its chain needs source maps, which the
 * MAIN world fetches from the page's own dev server. The isolated side dispatches
 * `CustomEvent(COMPONENT_REFINE_EVENT, { detail: <nonce> })` on the element; the MAIN world answers
 * with `CustomEvent(COMPONENT_REFINED_EVENT, { detail: <JSON of { nonce, info: FrameworkInfo }> })`
 * on window. Strings cross between the worlds; the answer is parsed like the attribute.
 */
export const COMPONENT_REFINE_EVENT = "pointcast:component-refine";
export const COMPONENT_REFINED_EVENT = "pointcast:component-refined";

const MAX_NAME = 80;
const MAX_FILE = 300;

function shortString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** What the MAIN-world script answers: `ElementInfo.component` and `ElementInfo.renderedBy`. */
export interface FrameworkInfo {
  component?: ComponentInfo;
  renderedBy?: CodeFrame[];
}

const MAX_FRAMES = 3;

/**
 * A captured file path, bounded and made project-relative. Normalized again here (framework-main.ts
 * already does it): the attribute is untrusted page input, so a page that bypasses the MAIN-world
 * script and writes it directly must not be able to smuggle an absolute path (D8, PRIVACY) past
 * this parser.
 */
function safeFile(value: unknown): string | undefined {
  const file = shortString(value, MAX_FILE);
  return file === undefined ? undefined : shortString(projectRelativePath(file), MAX_FILE);
}

/**
 * Keeps only the ComponentInfo fields, with the right types and bounded sizes. Page scripts can
 * write the attribute too, so its content is untrusted input: nothing but names and positions
 * may come through.
 */
export function parseComponentInfo(raw: unknown): ComponentInfo | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const data = raw as Record<string, unknown>;
  const framework = shortString(data.framework, 20);
  if (framework === undefined) return undefined;
  const info: ComponentInfo = { framework: framework.toLowerCase() };
  const name = shortString(data.name, MAX_NAME);
  const file = safeFile(data.file);
  const line = positiveInteger(data.line);
  const column = positiveInteger(data.column);
  if (name !== undefined) info.name = name;
  if (file !== undefined) info.file = file;
  if (line !== undefined) info.line = line;
  if (line !== undefined && column !== undefined) info.column = column;
  return info.name !== undefined || info.file !== undefined ? info : undefined;
}

/** How many raw frames are looked at, at most: the attribute is untrusted page input. */
const MAX_RAW_FRAMES = 100;

/**
 * Same rules for `renderedBy`: at most 3 frames, each with an app file, names and positions only.
 * Frames without a file or in library code (node_modules…) are skipped before the cap, so library
 * wrappers never take the places of the app's own frames.
 */
export function parseRenderedBy(raw: unknown): CodeFrame[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  // Read and empty (a Next.js page's own markup: core's codeChain uses the element's own file:line).
  if (raw.length === 0) return [];
  const frames: CodeFrame[] = [];
  for (const item of raw.slice(0, MAX_RAW_FRAMES)) {
    if (frames.length === MAX_FRAMES) break;
    if (typeof item !== "object" || item === null) continue;
    const data = item as Record<string, unknown>;
    // Tested before safeFile, whose projectRelativePath cuts an absolute node_modules path to "package/…".
    if (typeof data.file === "string" && isLibraryPath(data.file)) continue;
    const file = safeFile(data.file);
    if (file === undefined) continue;
    const frame: CodeFrame = { file };
    const component = shortString(data.component, MAX_NAME);
    const line = positiveInteger(data.line);
    const column = positiveInteger(data.column);
    if (component !== undefined) frame.component = component;
    if (line !== undefined) frame.line = line;
    if (line !== undefined && column !== undefined) frame.column = column;
    frames.push(frame);
  }
  return frames.length > 0 ? frames : undefined;
}

/** Parses the attribute's JSON; anything malformed is dropped, field by field. */
export function parseFrameworkInfo(json: string): FrameworkInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const data = raw as Record<string, unknown>;
  const component = parseComponentInfo(data.component);
  const renderedBy = parseRenderedBy(data.renderedBy);
  return {
    ...(component !== undefined ? { component } : {}),
    ...(renderedBy !== undefined ? { renderedBy } : {}),
  };
}

/** Asks the MAIN-world script which components rendered `el`; empty when nobody answers. */
export function requestFrameworkInfo(el: Element): FrameworkInfo {
  el.removeAttribute(COMPONENT_ATTRIBUTE);
  // The element's own realm's Event: jsdom test windows and the page are separate realms.
  const EventClass = el.ownerDocument.defaultView?.Event ?? Event;
  el.dispatchEvent(new EventClass(COMPONENT_REQUEST_EVENT, { bubbles: false, composed: true }));
  const json = el.getAttribute(COMPONENT_ATTRIBUTE);
  if (json === null) return {};
  el.removeAttribute(COMPONENT_ATTRIBUTE);
  return parseFrameworkInfo(json);
}

/** How long the isolated side waits for a refined answer (the MAIN world's budget is 3 s). */
export const REFINE_TIMEOUT_MS = 4_000;

/**
 * Asks the MAIN world again, asynchronously, for what needs source maps (a Next.js chain,
 * framework-main.ts refineFrameworkInfo). Resolves to the parsed answer, or {} when nobody answers
 * in time (no MAIN-world script, a production page).
 */
export function requestRefinedFrameworkInfo(el: Element, timeoutMs = REFINE_TIMEOUT_MS): Promise<FrameworkInfo> {
  const win = el.ownerDocument.defaultView;
  if (win === null) return Promise.resolve({});
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve) => {
    const done = (info: FrameworkInfo) => {
      win.removeEventListener(COMPONENT_REFINED_EVENT, onAnswer, true);
      clearTimeout(timer);
      resolve(info);
    };
    const onAnswer = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "string" || detail.length > 20_000) return;
      let data: unknown;
      try {
        data = JSON.parse(detail);
      } catch {
        return;
      }
      if (typeof data !== "object" || data === null || (data as { nonce?: unknown }).nonce !== nonce) return;
      done(parseFrameworkInfo(JSON.stringify((data as { info?: unknown }).info ?? {})));
    };
    const timer = setTimeout(() => done({}), timeoutMs);
    win.addEventListener(COMPONENT_REFINED_EVENT, onAnswer, true);
    // The element's own realm's CustomEvent: jsdom test windows and the page are separate realms.
    const EventClass = win.CustomEvent ?? CustomEvent;
    el.dispatchEvent(new EventClass(COMPONENT_REFINE_EVENT, { detail: nonce, bubbles: false, composed: true }));
  });
}