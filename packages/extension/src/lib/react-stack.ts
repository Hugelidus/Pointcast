/**
 * React 19 owner stacks under Next.js (D9 note 2026-09-28). React 19 dropped `_debugSource`; what
 * is left is `_debugStack`, an Error captured where each element was created. Under Next.js
 * (Turbopack) its frames are not source files:
 * - a Client Component's frames point into a bundled chunk,
 *   `http://localhost:3000/_next/static/chunks/components_0d-2y94._.js:111:385`, named after a
 *   hash as often as after the file;
 * - a Server Component has no fiber at all: React's Flight client rebuilds its stack from the
 *   server's, as fake frames `about://React/Server/<server chunk path>?<n>:<line>:<column>`, where
 *   the path is the absolute `.next/…` chunk on the developer's disk.
 * Both are mapped back through Next's own dev source maps, the way its error overlay does: a
 * client chunk's map is served next to it (`<chunk>.js.map`), a server chunk's by the dev
 * server's `/__nextjs_source-map?filename=<path>` endpoint. Pure functions only; the fetching and
 * the fibers are framework-main.ts's.
 */

/** One frame of a V8 stack trace: its location (1-based line and column). */
export interface StackFrame {
  url: string;
  line: number;
  column: number;
}

/**
 * Where the element (or component instance) whose `_debugStack` this is was created, by React's
 * own rule (formatOwnerStack in React 19): skip the "Error: react-stack-top-frame" line and the
 * JSX runtime's frame right after it (`jsxDEV`, or `fakeJSXCallSite` for a Server Component), and
 * nothing at or past `react_stack_bottom_frame` counts. Undefined when that frame has no location
 * (`at Function.all (<anonymous>)`: the component was rendered by the framework, not by app JSX).
 */
export function reactCallSite(stack: string): StackFrame | undefined {
  const lines = stack.split("\n");
  let start = 0;
  if (/^\s*Error: react-stack-top-frame\s*$/.test(lines[0] ?? "")) start = 1;
  const frames = lines.slice(start).filter((line) => /^\s*at\s/.test(line));
  // frames[0] is the JSX call itself.
  const site = frames[1];
  if (site === undefined || site.includes("react_stack_bottom_frame")) return undefined;
  return parseFrame(site);
}

/** Every frame of a stack with a location, in order (used to find the project root). */
export function stackUrls(stack: string): string[] {
  return stack.split("\n").flatMap((line) => parseFrame(line)?.url ?? []);
}

/** "    at Name (url:1:2)" or "    at url:1:2" -> its location; undefined for "<anonymous>", "native". */
function parseFrame(line: string): StackFrame | undefined {
  const match = /^\s*at\s+(?:.*?\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
  if (match === null) return undefined;
  const lineNumber = Number(match[2]);
  const column = Number(match[3]);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isInteger(column) || column < 1) return undefined;
  return { url: match[1], line: lineNumber, column };
}

/** The kinds of frame this module maps; anything else is left to framework-main.ts's older rules. */
export type MappedKind = "next-chunk" | "server";

/**
 * "next-chunk": a Next.js client chunk of the page's own origin (`/_next/static/chunks/…`);
 * "server": a Server Component's fake frame (`about://React/<environment>/…`). Undefined otherwise
 * (Vite's `/src/App.tsx`, webpack's `webpack-internal:///…`, other origins).
 */
export function mappedKind(url: string, origin: string): MappedKind | undefined {
  if (/^about:\/\/React\/[^/]+\//.test(url)) return "server";
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname.includes("/_next/static/chunks/") ? "next-chunk" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The server-side file of a Server Component frame, as the server wrote it:
 * "about://React/Server/C:%5CUsers%5C…%5C_15w6fn-._.js?10" -> "C:\Users\…\_15w6fn-._.js". The "?10"
 * numbers React's fake functions and is not part of the file.
 */
export function serverFile(url: string): string | undefined {
  const match = /^about:\/\/React\/[^/]+\/(.+?)(\?\d+)?$/.exec(url);
  if (match === null) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * The URL of a frame's source map, on the page's own origin only:
 * - a client chunk's map is the chunk's URL plus ".map" (Next's own findSourceMapURL for
 *   Turbopack chunks: "we control how those source maps are generated");
 * - a Server Component's through `<basePath>/__nextjs_source-map?filename=<its server file>`, which
 *   needs the page to be a Next.js page (`basePath` defined: nextBasePath).
 */
export function sourceMapUrl(frame: StackFrame, kind: MappedKind, origin: string, basePath: string | undefined): string | undefined {
  if (kind === "next-chunk") {
    const url = new URL(frame.url);
    return `${url.origin}${url.pathname}.map`;
  }
  const file = serverFile(frame.url);
  if (file === undefined || basePath === undefined) return undefined;
  return `${origin}${basePath}/__nextjs_source-map?filename=${encodeURIComponent(file)}`;
}

/**
 * The page's Next.js base path ("" at the root, "/docs" with `basePath: "/docs"`), read from the
 * URL of any of its `/_next/static/` scripts; undefined when the page loads none (not Next.js).
 */
export function nextBasePath(scriptUrls: Iterable<string>, origin: string): string | undefined {
  for (const src of scriptUrls) {
    try {
      const url = new URL(src);
      const at = url.pathname.indexOf("/_next/static/");
      if (url.origin === origin && at >= 0) return url.pathname.slice(0, at);
    } catch {
      // not a URL
    }
  }
  return undefined;
}

/**
 * The project root, from a Server Component frame's server file: the folder that holds `.next/`
 * ("C:\Users\me\shop\.next\dev\server\chunks\ssr\x.js" -> "C:/Users/me/shop"). Forward slashes.
 * Undefined when the path has no `.next` folder (a custom distDir, another RSC framework).
 */
export function projectRootOf(file: string): string | undefined {
  const path = file.replace(/\\/g, "/").replace(/^file:\/\/(?=\/)/i, "");
  const at = path.indexOf("/.next/");
  return at > 0 ? path.slice(0, at) : undefined;
}

/** What a mapped source is to the app. */
export type SourceFile = { kind: "app"; file: string } | { kind: "library"; file: string };

/**
 * A source map's `source` as the chain wants it: a project-relative app file ("components/
 * nav-link.tsx"), or a library file ("node_modules/…", which the chain skips). Turbopack writes
 * absolute `file:///…` sources; older versions `turbopack:///[project]/…`. A file outside the
 * project root, or any source when the root is unknown and the path is not in node_modules, is
 * undefined: the chain stops there rather than name a path it cannot vouch for.
 */
export function sourceFile(source: string, root: string | undefined): SourceFile | undefined {
  const project = /^turbopack:\/\/\/\[project\]\/(.+)$/.exec(source)?.[1];
  if (project !== undefined) return classify(project);
  if (!/^file:\/\//i.test(source)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(source.replace(/^file:\/\//i, "")).replace(/^\/(?=[a-zA-Z]:)/, "").replace(/\\/g, "/");
  } catch {
    return undefined;
  }
  if (root !== undefined) {
    const prefix = `${root.replace(/\/+$/, "")}/`;
    // Windows paths compare without case (the drive letter's case varies between tools).
    const inside = /^[a-zA-Z]:\//.test(path) ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix);
    if (inside) return classify(path.slice(prefix.length));
  }
  const modules = path.lastIndexOf("/node_modules/");
  return modules >= 0 ? { kind: "library", file: path.slice(modules + 1) } : undefined;
}

function classify(relative: string): SourceFile | undefined {
  const clean = relative.replace(/^\.\/+/, "");
  if (clean === "" || clean.split("/").includes("..")) return undefined;
  return /(^|\/)node_modules\//.test(clean) ? { kind: "library", file: clean.slice(clean.indexOf("node_modules/")) } : { kind: "app", file: clean };
}
