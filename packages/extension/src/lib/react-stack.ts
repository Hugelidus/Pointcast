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

// ------------------------------------------------------- React 19 on Vite (D9 note 2026-09-29)

/*
 * On Vite, React 19's frames name the modules the dev server serves
 * (`http://localhost:5173/src/components/Sidebar.tsx?t=1716:29:59`), which are the app's files, but
 * their positions are in the transformed module. Vite serves each module with its source map
 * inline, at its end (`//# sourceMappingURL=data:application/json;base64,…`), whose `sources` name
 * the module's own file relative to it (`["Sidebar.tsx"]`). These are the pure parts of reading it;
 * the fetching is framework-main.ts's.
 */

/**
 * Whether the page is served by a Vite dev server: it loads `/@vite/client` from its own origin
 * (Vite injects that script into every page it serves, SvelteKit's included).
 */
export function isViteDevPage(scriptUrls: Iterable<string>, origin: string): boolean {
  for (const src of scriptUrls) {
    try {
      const url = new URL(src);
      if (url.origin === origin && url.pathname.endsWith("/@vite/client")) return true;
    } catch {
      // not a URL
    }
  }
  return false;
}

/** Where a module's source map is: its JSON text (an inline data URL), or another URL of the same origin. */
export type MapReference = { kind: "inline"; json: string } | { kind: "url"; url: string };

/**
 * The source map a served module declares with its last `//# sourceMappingURL=` comment, which must
 * end the module (only whitespace after it). A data URL is decoded (base64 or percent-encoded); a
 * URL is resolved against the module's and kept only on the module's origin. Undefined when there
 * is none, or it cannot be read.
 */
export function sourceMapReference(moduleText: string, moduleUrl: string): MapReference | undefined {
  const key = "sourceMappingURL=";
  const at = moduleText.lastIndexOf(key);
  if (at < 0 || !/\/\/[#@][ \t]*$/.test(moduleText.slice(Math.max(0, at - 8), at))) return undefined;
  const value = /^([^\s'"]+)\s*$/.exec(moduleText.slice(at + key.length))?.[1];
  if (value === undefined) return undefined;
  if (value.startsWith("data:")) {
    const data = /^data:application\/json(?:;[\w.+-]+=[\w.+-]+)*(;base64)?,(.*)$/i.exec(value);
    if (data === null) return undefined;
    const json = data[1] !== undefined ? decodeBase64Utf8(data[2]) : decodePercent(data[2]);
    return json === undefined ? undefined : { kind: "inline", json };
  }
  try {
    const url = new URL(value, moduleUrl);
    return url.origin === new URL(moduleUrl).origin ? { kind: "url", url: url.href } : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Utf8(text: string): string | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodePercent(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * Whether a map's `source` is the served module's own file: resolved against the module's URL, the
 * same path (Vite writes `"Sidebar.tsx"` for `/src/components/Sidebar.tsx`), or an absolute file
 * path that ends with the module's path. Anything else (another file, a virtual module) is not
 * taken: the line would be another file's.
 */
export function isModuleSource(source: string, moduleUrl: string): boolean {
  let modulePath: string;
  try {
    modulePath = decodeURIComponent(new URL(moduleUrl).pathname);
  } catch {
    return false;
  }
  const file = source.replace(/\\/g, "/");
  // An absolute file path: "C:/me/app/src/App.tsx" or "/home/me/app/src/App.tsx" ends with
  // "/src/App.tsx"; a module outside the root ("/@fs/C:/me/lib/x.tsx") is compared without "/@fs".
  const absolute = /^[a-zA-Z]:\//.test(file) ? `/${file}` : /^\/(?!\/)/.test(file) ? file : undefined;
  const served = modulePath.replace(/^\/@fs(?=\/)/, "");
  if (absolute !== undefined && served.length > 1 && absolute.endsWith(served)) return true;
  try {
    return decodeURIComponent(new URL(file, moduleUrl).pathname) === modulePath;
  } catch {
    return false;
  }
}

/**
 * Whether the served code at a frame's position is a JSX runtime call (`_jsxDEV(`, `jsx(`,
 * `React.createElement(`), where V8 puts a call site created by JSX. A module edited since the
 * element was created is served in its new version: its positions would then land elsewhere, and
 * the line is not taken.
 */
export function isJsxCallAt(moduleText: string, line: number, column: number): boolean {
  let start = 0;
  for (let n = 1; n < line; n++) {
    start = moduleText.indexOf("\n", start) + 1;
    if (start === 0) return false;
  }
  const at = start + column - 1;
  const end = moduleText.indexOf("\n", at);
  const text = moduleText.slice(at, end < 0 ? undefined : Math.min(end, at + 200));
  return /^[\w$.]*(?:jsx[\w$]*|createElement)\s*\(/.test(text);
}
