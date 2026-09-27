import { projectRelativePath } from "../paths";
import type { CodeFrame, ElementInfo } from "../schema";

/**
 * The code chain of one element, normalized with the rules Stage 0 tested
 * (docs/eval/stage0-code-pointer-2026-09-27.md). The resolver searches these files and the
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
}

/** At most this many app-owned frames (Stage 0). */
export const MAX_CHAIN_FRAMES = 3;

/** Library and generated code: never a place the agent should edit. */
export const NOT_APP_CODE =/(^|\/)(node_modules|\.vite|\.svelte-kit)\//;

/**
 * `renderedBy` normalized, innermost first:
 * - frames in node_modules, .vite or .svelte-kit are dropped; their package names the next frame
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
 * Empty without renderedBy, so older sessions render and resolve exactly as before.
 */
export function codeChain(element: ElementInfo): ChainFrame[] {
  const given = Array.isArray(element.renderedBy) ? element.renderedBy.filter(isFrame) : [];
  if (given.length === 0) return [];

  const own = element.component;
  const ownFile = typeof own?.file === "string" && own.file !== "" ? cleanPath(own.file) : undefined;
  const ownPackage = ownFile === undefined ? undefined : libraryPackage(ownFile);

  const raw: { file: string; line?: number; component?: string; host?: boolean; snippet?: string }[] = given.map((frame) => ({
    file: cleanPath(frame.file),
    line: positiveInteger(frame.line),
    component: typeof frame.component === "string" && frame.component !== "" ? frame.component : undefined,
    snippet: typeof frame.snippet === "string" && frame.snippet.trim() !== "" ? frame.snippet : undefined,
  }));
  // Only a file:line is the element's own location (Svelte's loc, React's _debugSource); Vue's
  // file-only component can be the component that renders a slot, not where the tag is written.
  const ownLine = positiveInteger(own?.line);
  const startsAtInstance = raw[0].component !== undefined && raw[0].component !== element.tag;
  if (startsAtInstance && ownFile !== undefined && ownLine !== undefined && !NOT_APP_CODE.test(ownFile) && ownFile !== raw[0].file) {
    raw.unshift({ file: ownFile, line: ownLine, host: true });
  }

  const chain: ChainFrame[] = [];
  let droppedPackage: string | undefined;
  for (const frame of raw) {
    if (NOT_APP_CODE.test(frame.file)) {
      droppedPackage = libraryPackage(frame.file) ?? droppedPackage;
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
    });
    droppedPackage = undefined;
    if (chain.length === MAX_CHAIN_FRAMES) break;
  }
  return chain;
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
    const name = (segments[segments.length - 1] ?? "").replace(/[?#].*$/, "").replace(/\.[^.]+$/, "");
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

function isFrame(value: unknown): value is CodeFrame {
  return typeof value === "object" && value !== null && typeof (value as CodeFrame).file === "string" && (value as CodeFrame).file !== "";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
