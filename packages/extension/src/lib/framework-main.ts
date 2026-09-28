import { isLibraryPath, projectRelativePath, type CodeFrame, type ComponentInfo } from "@pointcast/core";
import {
  COMPONENT_ATTRIBUTE,
  COMPONENT_REFINED_EVENT,
  COMPONENT_REFINE_EVENT,
  COMPONENT_REQUEST_EVENT,
  type FrameworkInfo,
} from "./component-bridge";
import { composedParent } from "./dom";
import {
  mappedKind,
  nextBasePath,
  projectRootOf,
  reactCallSite,
  serverFile,
  sourceFile,
  sourceMapUrl,
  stackUrls,
  type MappedKind,
  type StackFrame,
} from "./react-stack";
import { originalPosition, parseSourceMap, type SourceMap } from "./source-map";

/**
 * MAIN-world half of the component bridge (protocol in component-bridge.ts). Runs in the page's
 * own JS world, where framework dev data on DOM nodes is visible. It only reads: names, file
 * paths and positions leave this file, never props, state or anything else a component holds.
 * Every framework is optional; missing or unexpected internals mean "no answer", never an error.
 */

// Framework internals are untyped by nature; each reader checks every field it uses.
type Loose = Record<string, unknown> | undefined;

function asObject(value: unknown): Loose {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** "src/components/OrderRow.vue" → "OrderRow": what Vue and Svelte call a component by default. */
function baseName(file: string): string | undefined {
  return str(file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, ""));
}

/**
 * Dev builds sometimes report a component's file as an absolute path on this machine (Vue's
 * `__file`, a Svelte source map, React's `_debugSource`), which would leak the user's home
 * directory and username into session.json and the rendered spec (D8, PRIVACY). Every file that
 * leaves this module goes through this first.
 */
function normalizeFile(file: string | undefined): string | undefined {
  return file === undefined ? undefined : projectRelativePath(file);
}

function withoutUndefined<T extends object>(info: T): T {
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as T;
}

/** Vue's name for a component type; an SFC without one is called after its file. */
function vueName(type: Loose): string | undefined {
  const file = str(type?.__file);
  return str(type?.name) ?? str(type?.__name) ?? (file ? baseName(file) : undefined);
}

// -------------------------------------------------------------------------------------- Vue

/**
 * Vue 3 dev builds put the owning component instance on each element it renders. The nearest
 * instance with a name or file is the component the user means (skips anonymous wrappers).
 */
function readVue(el: Element): ComponentInfo | undefined {
  let instance = asObject((el as unknown as Record<string, unknown>).__vueParentComponent);
  for (let depth = 0; instance !== undefined && depth < 20; depth++) {
    const type = asObject(instance.type);
    const file = normalizeFile(str(type?.__file));
    const name = vueName(type);
    if (name !== undefined || file !== undefined) return withoutUndefined<ComponentInfo>({ framework: "vue", name, file });
    instance = asObject(instance.parent);
  }
  return undefined;
}

// ----------------------------------------------------------------------------------- Svelte

/**
 * Svelte dev builds tag each element with where it is written in the .svelte file. Svelte 4
 * reports 0-based lines and columns and also sets `char`; Svelte 5 reports 1-based lines, still
 * 0-based columns, and has no `char`. The output is always 1-based, like "file:line:col" source
 * attributes.
 */
function readSvelte(el: Element): ComponentInfo | undefined {
  const loc = asObject(asObject((el as unknown as Record<string, unknown>).__svelte_meta)?.loc);
  const file = normalizeFile(str(loc?.file));
  if (loc === undefined || file === undefined) return undefined;
  const zeroBased = "char" in loc;
  const line = num(loc.line);
  const column = num(loc.column);
  return withoutUndefined<ComponentInfo>({
    framework: "svelte",
    name: baseName(file),
    file,
    line: line === undefined ? undefined : line + (zeroBased ? 1 : 0),
    column: column === undefined ? undefined : column + 1,
  });
}

// ------------------------------------------------------------------------------------ React

function fiberOf(el: Element): Loose {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  return key === undefined ? undefined : asObject((el as unknown as Record<string, unknown>)[key]);
}

/** Display name of a component type: function/class, forwardRef ({render}) or memo ({type}). */
function reactName(type: unknown, depth = 0): string | undefined {
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    return str(fn.displayName) ?? str(fn.name);
  }
  const object = asObject(type);
  if (object === undefined || depth > 3) return undefined;
  return str(object.displayName) ?? reactName(object.render, depth + 1) ?? reactName(object.type, depth + 1);
}

/**
 * React keeps a fiber on every element it renders, in production too, where component names
 * are minified. `_debugOwner` exists on fibers of development builds only, so it tells a real
 * name ("OrdersTable") from a minified one ("t"). File and line come from `_debugSource`, which
 * React up to 18 fills from the JSX dev transform; React 19 dropped it, so only the name remains.
 */
function readReact(el: Element, mapping: Mapping): ComponentInfo | undefined {
  const hostFiber = fiberOf(el);
  if (hostFiber === undefined || !("_debugOwner" in hostFiber)) return undefined;
  const source = asObject(hostFiber._debugSource);
  if (source === undefined) {
    const mapped = readMappedReact(hostFiber, { ...mapping, root: rootFinder(hostFiber) });
    if (mapped !== undefined) return mapped;
    // React 19 on Vite (D9 note 2026-09-28, pass 2): the element's own JSX call site names the
    // app file it is written in, and its owner the component that wrote it.
    const own = ownJsxFile(hostFiber);
    const owner = ownerName(asObject(hostFiber._debugOwner));
    if (own !== undefined && owner !== undefined) return { framework: "react", name: owner, file: own };
  }
  let fiber: Loose = asObject(hostFiber.return);
  for (let depth = 0; fiber !== undefined && depth < 50; depth++) {
    const name = reactName(fiber.type);
    if (name !== undefined) {
      return withoutUndefined<ComponentInfo>({
        framework: "react",
        name,
        // Where this element's JSX is written: inside the component named above.
        file: normalizeFile(str(source?.fileName)),
        line: num(source?.lineNumber),
        column: num(source?.columnNumber),
      });
    }
    fiber = asObject(fiber.return);
  }
  return undefined;
}

// ------------------------------------------------- React 19 under Next.js (react-stack.ts)

/**
 * How React 19 stacks are mapped to source for one request (D9 note 2026-09-28). The same page
 * is read twice: synchronously at the gesture, with no maps (`maps` undefined: names only), and
 * then asynchronously with the maps fetched from the page's own dev server (refineFrameworkInfo).
 */
interface Mapping {
  /** The page's origin: only its own chunks are mapped, and maps are only fetched from it. */
  origin: string;
  /** Next.js's base path, when the page is a Next.js page (nextBasePath). */
  basePath: string | undefined;
  /** Source maps by URL: undefined = not fetched yet, null = none (404, not a map). */
  maps?: (url: string) => SourceMap | null | undefined;
  /** The project root (react-stack.ts projectRootOf), found once per request when first needed. */
  root: () => string | undefined;
  /**
   * `stopped`: a chain ended at a call site that could not be mapped (not at its outermost owner).
   * `libraryPlaced`: it ended at the element's own component, placed by library code (reactFrames).
   */
  state?: { stopped: boolean; libraryPlaced?: boolean };
}

/** Thrown while reading a chain that needs a source map not fetched yet (`url`). */
class NeedMap {
  constructor(readonly url: string | undefined) {}
}

type Located = { kind: "app"; file: string; line: number; column: number } | { kind: "library"; file: string } | { kind: "unmapped" };

/** `_debugStack` of a fiber; `debugStack` of a Server Component's ReactComponentInfo. */
function stackOf(node: Loose): string | undefined {
  return str(asObject(node?._debugStack)?.stack) ?? str(asObject(node?.debugStack)?.stack);
}

/**
 * A Server Component has no fiber: React 19 gives its client children a ReactComponentInfo
 * (`{ name, env: "Server", owner, debugStack }`) as `_debugOwner`.
 */
function isServerInfo(node: Loose): boolean {
  return node !== undefined && typeof node.env === "string" && !("tag" in node);
}

function ownerName(owner: Loose): string | undefined {
  if (owner === undefined) return undefined;
  return reactName(owner.type) ?? (isServerInfo(owner) ? str(owner.name) : undefined);
}

/** The next owner out: a fiber's `_debugOwner`, a Server Component info's `owner`. */
function nextOwner(owner: NonNullable<Loose>): Loose {
  return asObject(owner._debugOwner) ?? (isServerInfo(owner) ? asObject(owner.owner) : undefined);
}

/** A client chunk named after node_modules ("node_modules__pnpm_14ms__x._.js") is library code: not worth its map. */
function isLibraryChunk(url: string): boolean {
  try {
    return /(^|\/)node_modules_/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * The source location of a call site in a Next.js chunk or a Server Component frame. Throws
 * NeedMap when its map has not been fetched (or `maps` is undefined: names only). "unmapped" when
 * the map is missing, has no segment there, or names a file this cannot vouch for: the chain stops
 * there, so a later frame never takes the place of one that could not be read.
 */
function locate(site: StackFrame, kind: MappedKind, mapping: Mapping): Located {
  if (kind === "next-chunk" && isLibraryChunk(site.url)) return { kind: "library", file: "node_modules/" };
  const url = sourceMapUrl(site, kind, mapping.origin, mapping.basePath);
  if (url === undefined) return { kind: "unmapped" };
  const map = mapping.maps?.(url);
  if (map === undefined) throw new NeedMap(mapping.maps === undefined ? undefined : url);
  if (map === null) return { kind: "unmapped" };
  const position = originalPosition(map, site.line, site.column);
  const file = position === undefined ? undefined : sourceFile(position.source, mapping.root());
  if (position === undefined || file === undefined) return { kind: "unmapped" };
  return file.kind === "library" ? file : { kind: "app", file: file.file, line: position.line, column: position.column };
}

/** The mappable call site of a node's own stack, with its kind; undefined for older stacks (Vite). */
function mappableSite(node: Loose, mapping: Mapping): { site: StackFrame; kind: MappedKind } | undefined {
  const stack = stackOf(node);
  const site = stack === undefined ? undefined : reactCallSite(stack);
  const kind = site === undefined ? undefined : mappedKind(site.url, mapping.origin);
  return site === undefined || kind === undefined ? undefined : { site, kind };
}

/**
 * React 19 under Next.js: the component that wrote the element's JSX (its owner, a Server
 * Component included) and, once maps are fetched, where: the element's own call site. Undefined
 * for stacks this does not map (Vite serves source files, and keeps the older rules).
 */
function readMappedReact(hostFiber: NonNullable<Loose>, mapping: Mapping): ComponentInfo | undefined {
  const own = mappableSite(hostFiber, mapping);
  if (own === undefined) return undefined;
  const name = ownerName(asObject(hostFiber._debugOwner));
  if (mapping.maps === undefined) return name === undefined ? undefined : { framework: "react", name };
  const located = locate(own.site, own.kind, mapping);
  const where = located.kind === "app" ? { file: located.file, line: located.line, column: located.column } : {};
  return name === undefined && located.kind !== "app" ? undefined : withoutUndefined<ComponentInfo>({ framework: "react", name, ...where });
}

/**
 * The project root, from the first Server Component frame on the element's owner stacks (every
 * App Router page has one: its root layout). Only read when a mapped source is absolute.
 */
function rootFinder(hostFiber: NonNullable<Loose>): () => string | undefined {
  let found: { root: string | undefined } | undefined;
  return () => {
    if (found !== undefined) return found.root;
    found = { root: undefined };
    let node: Loose = hostFiber;
    for (let depth = 0; node !== undefined && depth < MAX_CHAIN; depth++, node = nextOwner(node)) {
      for (const url of stackUrls(stackOf(node) ?? "")) {
        const file = url.startsWith("about://") ? serverFile(url) : undefined;
        const root = file === undefined ? undefined : projectRootOf(file);
        if (root !== undefined) {
          found.root = root;
          return root;
        }
      }
    }
    return undefined;
  };
}

// ------------------------------------------------------------------------------- renderedBy

/**
 * One component instance as a framework reports it, before app filtering: the file may be
 * absolute, in node_modules or generated.
 */
interface RawFrame {
  component?: string;
  file?: string;
  line?: number;
  column?: number;
}

const MAX_FRAMES = 3;
/** How far any framework's chain is followed; real chains are far shorter. */
const MAX_CHAIN = 100;
/**
 * Library, pre-bundled (Vite's dependency cache) and generated code is not the app's own source.
 * Core's rule (resolve/chain.ts), so capture and rendering agree on what a library frame is.
 */
function isAppFile(file: string | undefined): file is string {
  return file !== undefined && !isLibraryPath(file);
}

/**
 * The chain written to `ElementInfo.renderedBy`: app frames only, innermost first. A run of
 * frames in the same file keeps its innermost one (the others are wrappers written in that same
 * file), so the chain climbs to the next file sooner. `frames` may be lazy: nothing past the
 * third kept frame is read, because a later frame can never change the first three.
 */
function appChain(frames: Iterable<RawFrame>): CodeFrame[] | undefined {
  const chain: CodeFrame[] = [];
  for (const frame of frames) {
    if (!isAppFile(frame.file)) continue;
    const file = projectRelativePath(frame.file);
    if (file === "" || chain[chain.length - 1]?.file === file) continue;
    chain.push(withoutUndefined<CodeFrame>({ component: frame.component, file, line: frame.line, column: frame.column }));
    if (chain.length === MAX_FRAMES) break;
  }
  return chain.length > 0 ? chain : undefined;
}

/**
 * Vue 3: the component instances from the element's owner outwards (`parent`). Each one is
 * written in the template of the component whose render created its vnode (`vnode.ctx`, right
 * for slot content too, e.g. a button passed into a card component). When that one has no app
 * file (a RouterView, a library wrapper), the nearest ancestor with one stands in. Vue keeps no
 * template positions at runtime, so these frames have files only.
 */
function vueFrames(owner: NonNullable<Loose>): RawFrame[] {
  const instances: NonNullable<Loose>[] = [];
  for (let instance: Loose = owner; instance !== undefined && instances.length < MAX_CHAIN; ) {
    instances.push(instance);
    instance = asObject(instance.parent);
  }
  const frames: RawFrame[] = [];
  // Walked from the outside in, so `ancestorFile` is the nearest app file above instance k.
  let ancestorFile: string | undefined;
  for (let k = instances.length - 1; k >= 0; k--) {
    const instance = instances[k] as NonNullable<Loose>;
    const writtenIn = str(asObject(asObject(asObject(instance.vnode)?.ctx)?.type)?.__file);
    const own = str(asObject(instance.type)?.__file);
    // A library component created by library code (reka-ui's Primitive inside its own
    // DropdownMenuItem, a Presence, a Teleport wrapper) has no app source: the stand-in would
    // name a file it is not written in, and would take one of the 3 places from the app's frames.
    const standIn = isAppFile(own) ? ancestorFile : undefined;
    frames[k] = { component: vueName(asObject(instance.type)), file: isAppFile(writtenIn) ? writtenIn : standIn };
    if (isAppFile(own)) ancestorFile = own;
  }
  return frames;
}

/**
 * Svelte 5: `__svelte_meta.parent` is the stack of blocks the element was rendered in; each
 * "component" block is where a component tag is written (1-based line, 0-based column).
 * Svelte 4 has no such stack.
 */
function* svelteFrames(meta: NonNullable<Loose>): Generator<RawFrame> {
  let block = asObject(meta.parent);
  for (let depth = 0; block !== undefined && depth < MAX_CHAIN; depth++, block = asObject(block.parent)) {
    if (block.type !== "component") continue;
    const column = num(block.column);
    const line = num(block.line);
    yield { component: str(block.componentTag), file: str(block.file), line, column: column === undefined ? undefined : column + 1 };
  }
}

/**
 * "http://localhost:5173/src/App.tsx?t=1" → "src/App.tsx". Vite serves files outside the project
 * as "/@fs/<absolute path>": that stays absolute, so projectRelativePath can shorten it (D8).
 * Vite's other "/@…" URLs are virtual modules, not files.
 */
function fileOfUrl(url: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return undefined;
  }
  const outside = /^\/@fs(\/.+)$/.exec(path)?.[1];
  if (outside !== undefined) return outside.replace(/^\/(?=[a-zA-Z]:)/, "");
  return path.startsWith("/@") ? undefined : str(path.slice(1));
}

/**
 * React 19: `_debugStack` is the stack captured where the element was created. Its first app
 * module is the file that wrote the JSX. The line there is the transformed module's, and mapping
 * it back is not worth it (files alone served the agent as well, eval Stage 0), so none is kept.
 */
function stackFile(debugStack: unknown): string | undefined {
  const stack = str(asObject(debugStack)?.stack);
  if (stack === undefined) return undefined;
  for (const line of stack.split("\n")) {
    const url = /(https?:\/\/.+?):\d+:\d+\)?$/.exec(line.trim())?.[1];
    const file = url === undefined ? undefined : fileOfUrl(url);
    if (isAppFile(file)) return file;
  }
  return undefined;
}

/**
 * React 19 without `_debugSource` or mapped stacks (Vite): the app file an element's own JSX is
 * written in, from its `_debugStack` by React's own call-site rule (reactCallSite: the frame right
 * after the JSX runtime's). Undefined when that frame is library code (an element a library
 * component creates, Radix's Slot cloning a child) or not a served file. No line: the stack's
 * line is the transformed module's, not the source's.
 */
function ownJsxFile(fiber: NonNullable<Loose>): string | undefined {
  const stack = stackOf(fiber);
  const site = stack === undefined ? undefined : reactCallSite(stack);
  const file = site === undefined ? undefined : fileOfUrl(site.url);
  if (!isAppFile(file)) return undefined;
  const relative = normalizeFile(file);
  return relative === undefined || relative === "" ? undefined : relative;
}

/**
 * React: the owner chain (`_debugOwner`, the components whose render created each element),
 * each owner at the JSX that created it: `_debugSource` up to React 18, else `_debugStack`.
 * Under Next.js, the owners include Server Components (ReactComponentInfo, followed through
 * `owner`), and a call site in a chunk or a Server Component frame is mapped through the dev
 * server's source maps (locate). A call site that cannot be mapped ends the chain: the frames
 * after it would otherwise move up into its place. Lazy, because reading a `_debugStack` formats a
 * stack trace.
 */
function* reactFrames(hostFiber: NonNullable<Loose>, mapping: Mapping): Generator<RawFrame> {
  let owner = asObject(hostFiber._debugOwner);
  for (let depth = 0; owner !== undefined && depth < MAX_CHAIN; depth++, owner = nextOwner(owner)) {
    const component = ownerName(owner);
    const source = asObject(owner._debugSource);
    if (source !== undefined) {
      yield { component, file: str(source.fileName), line: num(source.lineNumber), column: num(source.columnNumber) };
      continue;
    }
    const mappable = mappableSite(owner, mapping);
    if (mappable === undefined) {
      const file = stackFile(owner._debugStack ?? owner.debugStack);
      // The element's own component was placed by library code (a router's `component: Dashboard`,
      // a lazy route): its instance is written nowhere in the app. Skipped, the next app frame out
      // (the router's `<Outlet />` in a layout) would take its place as "used at", a wrong answer.
      // The chain ends here instead: the element's own JSX file is its code (renderedBy: []).
      if (depth === 0 && !isAppFile(file) && ownJsxFile(hostFiber) !== undefined) {
        if (mapping.state !== undefined) mapping.state.libraryPlaced = true;
        return;
      }
      yield { component, file };
      continue;
    }
    const located = locate(mappable.site, mappable.kind, mapping);
    if (located.kind === "unmapped") {
      if (mapping.state !== undefined) mapping.state.stopped = true;
      return;
    }
    yield located.kind === "app"
      ? { component, file: located.file, line: located.line, column: located.column }
      : { component, file: located.file };
  }
}

/** The raw frames of the framework that rendered `el`; undefined when none did (in dev mode). */
function framesOf(el: Element, mapping: Mapping): Iterable<RawFrame> | undefined {
  const node = el as unknown as Record<string, unknown>;
  const vue = asObject(node.__vueParentComponent);
  if (vue !== undefined) return vueFrames(vue);
  const svelte = asObject(node.__svelte_meta);
  if (svelte !== undefined) return svelteFrames(svelte);
  const fiber = fiberOf(el);
  if (fiber !== undefined && "_debugOwner" in fiber) return reactFrames(fiber, { ...mapping, root: rootFinder(fiber) });
  return undefined;
}

/** Names only: no source map is fetched, and a chain that needs one is not read (NeedMap). */
function namesOnly(el: Element): Mapping {
  const win = el.ownerDocument.defaultView;
  const origin = win?.location.origin ?? "null";
  const scripts = [...el.ownerDocument.querySelectorAll("script[src]")].map((script) => (script as HTMLScriptElement).src);
  return { origin, basePath: nextBasePath(scripts, origin), root: () => undefined };
}

/** The walk of readRenderedBy; NeedMap goes through, any other throw means "not this framework". */
function chainOf(el: Element, mapping: Mapping): CodeFrame[] | undefined {
  for (let current: Element | null = el, depth = 0; current !== null && depth < 30; current = composedParent(current), depth++) {
    try {
      const frames = framesOf(current, mapping);
      if (frames !== undefined) return appChain(frames);
    } catch (error) {
      if (error instanceof NeedMap) throw error;
      // A getter in some framework's internals threw: treat it as "not this framework".
    }
  }
  return undefined;
}

function componentOf(el: Element, mapping: Mapping): ComponentInfo | undefined {
  for (let current: Element | null = el, depth = 0; current !== null && depth < 30; current = composedParent(current), depth++) {
    try {
      const info = readVue(current) ?? readSvelte(current) ?? readReact(current, mapping);
      if (info !== undefined) return info;
    } catch (error) {
      if (error instanceof NeedMap) throw error;
      // A getter in some framework's internals threw: treat it as "not this framework".
    }
  }
  return undefined;
}

/**
 * Both answers of the bridge with one mapping. Under Next.js, an element whose owners give no app
 * frame but whose own JSX was mapped to an app file (the markup of a page or layout, which the
 * framework renders) gets `renderedBy: []`: the chain was read and is empty, so core's codeChain
 * makes the element's own file:line a chain of one.
 */
function frameworkInfo(el: Element, base: Mapping): FrameworkInfo {
  const mapping: Mapping = { ...base, state: { stopped: false } };
  const component = componentOf(el, mapping);
  let renderedBy = chainOf(el, mapping);
  // Only when the owners were all read: a chain cut short by a map that failed is not "none".
  if (renderedBy === undefined && !mapping.state?.stopped && mapping.maps !== undefined && component?.framework === "react" && component.file !== undefined && component.line !== undefined) {
    const fiber = nearestFiber(el);
    if (fiber !== undefined && asObject(fiber._debugSource) === undefined && mappableSite(fiber, mapping) !== undefined) renderedBy = [];
  }
  // React 19 on Vite: the element's own component was placed by library code (reactFrames), and
  // its own JSX file is known (readReact): that file is its code, a chain of one in core.
  if (renderedBy === undefined && mapping.state?.libraryPlaced && component?.framework === "react" && component.file !== undefined) renderedBy = [];
  return { ...(component !== undefined ? { component } : {}), ...(renderedBy !== undefined ? { renderedBy } : {}) };
}

function nearestFiber(el: Element): NonNullable<Loose> | undefined {
  for (let current: Element | null = el, depth = 0; current !== null && depth < 30; current = composedParent(current), depth++) {
    const fiber = fiberOf(current);
    if (fiber !== undefined && "_debugOwner" in fiber) return fiber;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------ public

/**
 * The app-owned component instances that rendered `el` (ElementInfo.renderedBy), read at the
 * element or its nearest ancestor that a framework rendered. Best effort: undefined when there
 * is no dev data or no app frame, never an error. Synchronous: a chain that needs source maps
 * (Next.js) is undefined here, and read by refineFrameworkInfo.
 */
export function readRenderedBy(el: Element): CodeFrame[] | undefined {
  try {
    return chainOf(el, namesOnly(el));
  } catch {
    return undefined;
  }
}

/** The component that rendered `el` or its nearest rendered ancestor, from any framework. */
export function readComponent(el: Element): ComponentInfo | undefined {
  try {
    return componentOf(el, namesOnly(el));
  } catch {
    return undefined;
  }
}

/** The synchronous answer: what needs no source map (names only under Next.js). */
export function readFrameworkInfo(el: Element): FrameworkInfo {
  const mapping = namesOnly(el);
  try {
    return frameworkInfo(el, mapping);
  } catch {
    // NeedMap: a Next.js chain. Its component is still named (readMappedReact needs no map for that).
    const component = readComponent(el);
    return component !== undefined ? { component } : {};
  }
}

/** All the source maps of one refinement share this budget; the page's own dev server answers in ms. */
export const REFINE_BUDGET_MS = 3_000;
/** A chain reads at most this many maps: one per chunk its call sites are in. */
const MAX_MAPS = 16;
/** A map larger than this is not read (Next's own runtime chunks are a few MB). */
const MAX_MAP_CHARS = 30_000_000;

/**
 * The answer with source maps (D9 note 2026-09-28, Next.js): the chain is read, each time it
 * needs a map not fetched yet, that map is fetched from the page's own origin and the chain read
 * again. Within REFINE_BUDGET_MS; past it, or on any failure, the maps not fetched count as
 * missing, which ends the chain where they were needed (never a frame out of place). Only paths
 * relative to the project and line numbers come out: the absolute paths in Server Component
 * frames are only sent back to the dev server that wrote them.
 */
export async function refineFrameworkInfo(el: Element, fetchFn: typeof fetch, budgetMs = REFINE_BUDGET_MS): Promise<FrameworkInfo> {
  const base = namesOnly(el);
  const maps = new Map<string, SourceMap | null>();
  const mapping: Mapping = { ...base, maps: (url) => maps.get(url) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    for (let round = 0; round <= MAX_MAPS; round++) {
      try {
        return frameworkInfo(el, mapping);
      } catch (error) {
        if (!(error instanceof NeedMap) || error.url === undefined) throw error;
        maps.set(error.url, round === MAX_MAPS || controller.signal.aborted ? null : await fetchMap(error.url, fetchFn, controller.signal));
      }
    }
    return readFrameworkInfo(el);
  } catch {
    return readFrameworkInfo(el);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMap(url: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<SourceMap | null> {
  try {
    const response = await fetchFn(url, { signal, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await response.text();
    return text.length > MAX_MAP_CHARS ? null : (parseSourceMap(text) ?? null);
  } catch {
    return null;
  }
}

const INSTALLED = Symbol.for("pointcast.componentBridge");
/** A refine request's nonce: the isolated side's, echoed back. */
const MAX_NONCE = 64;

/** Answers component requests from the isolated content script; installing twice is a no-op. */
export function installComponentBridge(win: Window): void {
  const flags = win as unknown as Record<symbol, boolean>;
  if (flags[INSTALLED]) return;
  flags[INSTALLED] = true;
  // Taken now, at document_start: before the app, or debug capture (page-errors-main.ts), wraps
  // it, so fetching a source map is neither reported as the page's request nor seen by the app.
  const pageFetch = typeof win.fetch === "function" ? win.fetch.bind(win) : undefined;
  win.addEventListener(
    COMPONENT_REQUEST_EVENT,
    (event) => {
      // composedPath()[0] is the element even inside an open shadow root; target is retargeted.
      const el = event.composedPath()[0] as Element | undefined;
      if (el === undefined || typeof el.setAttribute !== "function") return;
      const answer = readFrameworkInfo(el);
      if (answer.component !== undefined || answer.renderedBy !== undefined) {
        el.setAttribute(COMPONENT_ATTRIBUTE, JSON.stringify(answer));
      }
    },
    true,
  );
  // The asynchronous request (component-bridge.ts requestRefinedFrameworkInfo): the answer comes
  // back as a CustomEvent on window whose detail is a JSON string, which both worlds can read.
  win.addEventListener(
    COMPONENT_REFINE_EVENT,
    (event) => {
      const el = event.composedPath()[0] as Element | undefined;
      const nonce = (event as CustomEvent<unknown>).detail;
      if (el === undefined || typeof el.setAttribute !== "function" || typeof nonce !== "string" || nonce.length > MAX_NONCE) return;
      const answer = pageFetch === undefined ? Promise.resolve(readFrameworkInfo(el)) : refineFrameworkInfo(el, pageFetch);
      void answer.then((info) => {
        const EventClass = (win as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent ?? CustomEvent;
        win.dispatchEvent(new EventClass(COMPONENT_REFINED_EVENT, { detail: JSON.stringify({ nonce, info }) }));
      });
    },
    true,
  );
}
