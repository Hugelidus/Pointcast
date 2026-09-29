import { projectRelativePath } from "../paths";
import type { CodeFrame, ElementInfo } from "../schema";

/**
 * The code chain of one element, normalized with the rules Stage 0 tested
 * (docs/eval/archive/stage0-code-pointer-2026-09-27.md). The resolver searches these files and the
 * renderer prints these frames, so both always talk about the same chain.
 */

/** One app-owned frame of the chain, as rendered and searched. */
export interface ChainFrame {
  /** Component name; absent for the element's own tag (`host`) and for unnamed components. */
  component?: string;
  /** True for the frame where the element's own tag is written, rendered as `<tag>`. */
  host: boolean;
  /** Package of a library component written at this frame ("flowbite-svelte"), when a path shows it. */
  pkg?: string;
  /** Project-relative, forward slashes, no leading slash. */
  file: string;
  line?: number;
  /** The source at `line`, from `CodeFrame.snippet` (set by the resolver). */
  snippet?: string;
  /**
   * True for a server-rendered template (pointcast-django's markers): the component is the
   * template's name and the file ends with it ("pim/row.html" in "templates/pim/row.html").
   * Rendered as "template `file`", not as a `<Component>`. Absent otherwise.
   */
  template?: true;
}

/** At most this many app-owned frames (Stage 0). */
export const MAX_CHAIN_FRAMES = 3;

/**
 * Library and generated code: never a place the agent should edit. Tested on forward-slash paths:
 * node_modules, pnpm's store (".pnpm/"), Vite's and SvelteKit's generated folders, and a bundler
 * chunk named after its flattened node_modules path
 * ("_next/static/chunks/node_modules_@radix-ui_react-slot_dist_index_mjs.js"), and Next.js's
 * build output: its client chunks as the dev server serves them ("_next/static/chunks/…", whatever
 * they are named: Turbopack names many after a hash) and its `.next/` folder (server chunks).
 */
export const NOT_APP_CODE = /(^|\/)((node_modules|\.pnpm|\.vite|\.svelte-kit|_next|\.next)\/|node_modules_)/;

/**
 * True for a library or generated file (NOT_APP_CODE). Test the path as captured, not its
 * cleanPath: projectRelativePath cuts an absolute node_modules path down to "package/…", which no
 * longer says it is a library.
 */
export function isLibraryPath(file: string): boolean {
  return NOT_APP_CODE.test(file.replace(/\\/g, "/"));
}

/**
 * `renderedBy` normalized, innermost first:
 * - library and generated frames (isLibraryPath) are dropped before the cap, so wrappers never take
 *   the app's places; the nearest dropped frame's package names the next frame
 *   ("flowbite-svelte `<TabItem>`"), as does a library `element.component`;
 * - when renderedBy starts at a component instance and app-owned dev data gives the element's own
 *   `file:line` (`element.component`, e.g. Svelte's loc), that location goes first, as in Stage 0.
 *   This is the only source of a `host` frame: the extension (framework-main.ts) never puts the
 *   element's own tag into renderedBy itself, so a given frame without a component name is an
 *   unnamed component instance (an anonymous library component, e.g. recharts' chart, or Vue's
 *   chart wrapper), never the host tag;
 * - consecutive frames in the same file collapse to the innermost one. Stage 0 showed this
 *   decides where the chain ends: uncollapsed, the Chats badge chain never leaves the shared
 *   nav-group.tsx and never reaches the file that imports the sidebar data;
 * - at most MAX_CHAIN_FRAMES, after collapsing.
 * Empty without renderedBy, so older sessions render and resolve exactly as before. An empty
 * renderedBy with the element's own app file:line (a Next.js page's own markup) is a chain of its
 * host frame alone.
 */
export function codeChain(element: ElementInfo): ChainFrame[] {
  const given = Array.isArray(element.renderedBy) ? element.renderedBy.filter(isFrame) : [];
  const own = element.component;
  const ownFile = typeof own?.file === "string" && own.file !== "" ? cleanPath(own.file) : undefined;
  const ownLibrary = typeof own?.file === "string" && own.file !== "" && isLibraryPath(own.file);
  const ownPackage = ownLibrary ? libraryPackage(own?.file as string) : undefined;

  if (given.length === 0) {
    // D9 note 2026-09-28 (Next.js): `renderedBy: []` says the chain was read and no app component
    // instance is above the element: its markup is written straight in a component the framework
    // itself renders (a page or a layout). Its own file:line (element.component) is then a chain
    // of one, the element's own tag. Without renderedBy at all (older sessions, production
    // builds), nothing changes.
    const line = positiveInteger(own?.line);
    return Array.isArray(element.renderedBy) && ownFile !== undefined && ownIsWhereWritten(own) && !ownLibrary
      ? [{ host: true, file: ownFile, ...(line === undefined ? {} : { line }) }]
      : [];
  }

  const raw: { file: string; library?: boolean; pkg?: string; line?: number; component?: string; host?: boolean; snippet?: string }[] = given.map((frame) => ({
    file: cleanPath(frame.file),
    // On the captured path: cleanPath cuts an absolute node_modules path down to "package/…".
    library: isLibraryPath(frame.file),
    pkg: libraryPackage(frame.file),
    line: positiveInteger(frame.line),
    component: typeof frame.component === "string" && frame.component !== "" ? frame.component : undefined,
    snippet: typeof frame.snippet === "string" && frame.snippet.trim() !== "" ? frame.snippet : undefined,
  }));
  // Only a file:line is the element's own location (Svelte's loc, React's _debugSource), or a
  // React file without a line (ownIsWhereWritten); Vue's file-only component can be the
  // component that renders a slot, not where the tag is written.
  const ownLine = positiveInteger(own?.line);
  const startsAtInstance = raw[0].component !== undefined && raw[0].component !== element.tag;
  if (startsAtInstance && ownFile !== undefined && ownIsWhereWritten(own) && !ownLibrary && ownFile !== raw[0].file) {
    raw.unshift({ file: ownFile, ...(ownLine === undefined ? {} : { line: ownLine }), host: true });
  }

  const chain: ChainFrame[] = [];
  let droppedPackage: string | undefined;
  for (const frame of raw) {
    // Skipped before the cap below, so library wrappers (Radix's Primitive, Slot, SlotClone,
    // Presence, Portal…) never take the places of the app's own frames. Only the nearest dropped
    // frame names the next one: an earlier wrapper's package may be another library's.
    if (frame.library) {
      droppedPackage = frame.pkg;
      continue;
    }
    if (chain.length > 0 && chain[chain.length - 1].file === frame.file) {
      droppedPackage = undefined;
      continue;
    }
    const first = chain.length === 0;
    // host is set only by the unshift above (the element's own tag, from `own`); a nameless given
    // frame is an unnamed component instance, rendered as "component", never as `<tag>`.
    const host = frame.host ?? false;
    const pkg =
      droppedPackage ?? (first && !host && frame.component !== undefined && frame.component === own?.name ? ownPackage : undefined);
    chain.push({
      ...(host || frame.component === undefined ? {} : { component: frame.component }),
      host,
      ...(pkg === undefined ? {} : { pkg }),
      file: frame.file,
      ...(frame.line === undefined ? {} : { line: frame.line }),
      ...(frame.line === undefined || frame.snippet === undefined ? {} : { snippet: frame.snippet }),
      ...(!host && isTemplateFrame(frame.file, frame.component) ? { template: true as const } : {}),
    });
    droppedPackage = undefined;
    if (chain.length === MAX_CHAIN_FRAMES) break;
  }
  return chain;
}

/**
 * True when `element.component` gives where the element's own tag is written: a file with a line
 * (Svelte's loc, React's `_debugSource`, React 19 owner stacks mapped under Next.js), or a React
 * file without one. React writes a file without a line only from the element's own JSX call site
 * on its `_debugStack` (React 19 on Vite, since 2026-09-28): the file is exact, and the line there
 * is the served module's, not the source's, so it is not kept. Vue's `__file` without a line is
 * not: it names the component instance around the element, which for slot content is not where
 * the tag is written.
 */
function ownIsWhereWritten(own: ElementInfo["component"]): boolean {
  if (typeof own !== "object" || own === null) return false;
  return positiveInteger(own.line) !== undefined || own.framework === "react";
}

/**
 * The npm package a library path belongs to: "node_modules/.pnpm/flowbite-svelte@1.28.1_…/
 * node_modules/flowbite-svelte/dist/tabs/TabItem.svelte" -> "flowbite-svelte". Vite's pre-bundled
 * deps are named after the package: "node_modules/.vite/deps/recharts.js" -> "recharts".
 */
export function libraryPackage(file: string): string | undefined {
  const path = file.replace(/\\/g, "/");
  const marker = "node_modules/";
  const at = path.lastIndexOf(marker);
  if (at < 0) return undefined;
  const segments = path.slice(at + marker.length).split("/");
  if (segments[0] === ".vite") {
    const last = segments[segments.length - 1] ?? "";
    // Cut at the first "?" or "#" without a regex: /[?#].*$/ is quadratic on many "#" (CodeQL).
    const cut = [last.indexOf("?"), last.indexOf("#")].filter((i) => i >= 0);
    const name = (cut.length > 0 ? last.slice(0, Math.min(...cut)) : last).replace(/\.[^.]+$/, "");
    if (name === "" || name.startsWith("chunk-")) return undefined;
    // Vite writes "@radix-ui/react-slot" as "@radix-ui_react-slot.js".
    return name.replace(/^(@[^_/]+)_/, "$1/");
  }
  if (segments[0] === "" || segments[0].startsWith(".")) return undefined;
  if (segments[0].startsWith("@")) return segments.length > 1 ? `${segments[0]}/${segments[1]}` : undefined;
  return segments[0];
}

/** Project-relative (D8), forward slashes, without a leading "./" or "/". */
export function cleanPath(file: string): string {
  return projectRelativePath(file).replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
}

/**
 * A frame from template markers (D9 note 2026-09-28): its name is a template name, a path with an
 * extension that the file ends with. A framework component is never named like that.
 */
function isTemplateFrame(file: string, component: string | undefined): boolean {
  return component !== undefined && /\.[a-z\d]+$/i.test(component) && (file === component || file.endsWith(`/${component}`));
}

function isFrame(value: unknown): value is CodeFrame {
  return typeof value === "object" && value !== null && typeof (value as CodeFrame).file === "string" && (value as CodeFrame).file !== "";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
