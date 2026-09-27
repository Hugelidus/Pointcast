import { projectRelativePath, type CodeFrame, type ComponentInfo } from "@pointcast/core";
import { COMPONENT_ATTRIBUTE, COMPONENT_REQUEST_EVENT, type FrameworkInfo } from "./component-bridge";
import { composedParent } from "./dom";

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
function readReact(el: Element): ComponentInfo | undefined {
  const hostFiber = fiberOf(el);
  if (hostFiber === undefined || !("_debugOwner" in hostFiber)) return undefined;
  const source = asObject(hostFiber._debugSource);
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
/** Library, pre-bundled (Vite's dependency cache) and generated code: not the app's own source. */
const NOT_APP_FILE = /(^|[\\/])(node_modules|\.vite|\.svelte-kit)[\\/]/;

function isAppFile(file: string | undefined): file is string {
  return file !== undefined && !NOT_APP_FILE.test(file);
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
    frames[k] = { component: vueName(asObject(instance.type)), file: isAppFile(writtenIn) ? writtenIn : ancestorFile };
    const own = str(asObject(instance.type)?.__file);
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
 * React: the owner chain (`_debugOwner`, the components whose render created each element),
 * each owner at the JSX that created it: `_debugSource` up to React 18, else `_debugStack`.
 * Lazy, because reading a `_debugStack` formats a stack trace.
 */
function* reactFrames(hostFiber: NonNullable<Loose>): Generator<RawFrame> {
  let owner = asObject(hostFiber._debugOwner);
  for (let depth = 0; owner !== undefined && depth < MAX_CHAIN; depth++, owner = asObject(owner._debugOwner)) {
    const component = reactName(owner.type);
    const source = asObject(owner._debugSource);
    yield source !== undefined
      ? { component, file: str(source.fileName), line: num(source.lineNumber), column: num(source.columnNumber) }
      : { component, file: stackFile(owner._debugStack) };
  }
}

/** The raw frames of the framework that rendered `el`; undefined when none did (in dev mode). */
function framesOf(el: Element): Iterable<RawFrame> | undefined {
  const node = el as unknown as Record<string, unknown>;
  const vue = asObject(node.__vueParentComponent);
  if (vue !== undefined) return vueFrames(vue);
  const svelte = asObject(node.__svelte_meta);
  if (svelte !== undefined) return svelteFrames(svelte);
  const fiber = fiberOf(el);
  if (fiber !== undefined && "_debugOwner" in fiber) return reactFrames(fiber);
  return undefined;
}

// ------------------------------------------------------------------------------------ public

/**
 * The app-owned component instances that rendered `el` (ElementInfo.renderedBy), read at the
 * element or its nearest ancestor that a framework rendered. Best effort: undefined when there
 * is no dev data or no app frame, never an error.
 */
export function readRenderedBy(el: Element): CodeFrame[] | undefined {
  for (let current: Element | null = el, depth = 0; current !== null && depth < 30; current = composedParent(current), depth++) {
    try {
      const frames = framesOf(current);
      if (frames !== undefined) return appChain(frames);
    } catch {
      // A getter in some framework's internals threw: treat it as "not this framework".
    }
  }
  return undefined;
}

/** The component that rendered `el` or its nearest rendered ancestor, from any framework. */
export function readComponent(el: Element): ComponentInfo | undefined {
  for (let current: Element | null = el, depth = 0; current !== null && depth < 30; current = composedParent(current), depth++) {
    try {
      const info = readVue(current) ?? readSvelte(current) ?? readReact(current);
      if (info !== undefined) return info;
    } catch {
      // A getter in some framework's internals threw: treat it as "not this framework".
    }
  }
  return undefined;
}

const INSTALLED = Symbol.for("pointcast.componentBridge");

/** Answers component requests from the isolated content script; installing twice is a no-op. */
export function installComponentBridge(win: Window): void {
  const flags = win as unknown as Record<symbol, boolean>;
  if (flags[INSTALLED]) return;
  flags[INSTALLED] = true;
  win.addEventListener(
    COMPONENT_REQUEST_EVENT,
    (event) => {
      // composedPath()[0] is the element even inside an open shadow root; target is retargeted.
      const el = event.composedPath()[0] as Element | undefined;
      if (el === undefined || typeof el.setAttribute !== "function") return;
      const answer: FrameworkInfo = { component: readComponent(el), renderedBy: readRenderedBy(el) };
      if (answer.component !== undefined || answer.renderedBy !== undefined) {
        el.setAttribute(COMPONENT_ATTRIBUTE, JSON.stringify(answer));
      }
    },
    true,
  );
}
