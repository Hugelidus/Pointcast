// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { lacksLines } from "./component-bridge";
import { readFrameworkInfo, refineFrameworkInfo } from "./framework-main";
import { isJsxCallAt, isModuleSource, isViteDevPage, sourceMapReference } from "./react-stack";

/**
 * React 19 on Vite (D9 note 2026-09-29). The served modules in test-utils/vite-served are
 * dev/examples/react-dashboard's `src/main.tsx`, `src/App.tsx` and `src/components/Sidebar.tsx`
 * exactly as Vite 8.3 (@vitejs/plugin-react 5.2) served them, with the absolute project path
 * replaced; the stacks are the ones Chrome gave for its sidebar badge (React 19.3). Ground truth,
 * from the example's source: the badge `<span>` is written at Sidebar.tsx:26:44, `<Sidebar>` at
 * App.tsx:12:7, `<App />` at main.tsx:7:5.
 */
const ORIGIN = "http://localhost:5173";
const SERVED = join(dirname(fileURLToPath(import.meta.url)), "test-utils", "vite-served");
const served = (name: string): string => readFileSync(join(SERVED, `${name}.js.txt`), "utf8");
const MODULES: Record<string, string> = {
  "/src/main.tsx": served("main.tsx"),
  "/src/App.tsx": served("App.tsx"),
  "/src/components/Sidebar.tsx": served("Sidebar.tsx"),
};

const JSX = `exports.jsxDEV (${ORIGIN}/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=fba890eb:197:25)`;
const BOTTOM = `Object.react_stack_bottom_frame (${ORIGIN}/node_modules/.vite/deps/react-dom_client.js?v=72e49a0d:14142:12)`;
function stack(...frames: string[]): { stack: string } {
  return { stack: ["Error: react-stack-top-frame", ...[JSX, ...frames].map((frame) => `    at ${frame}`)].join("\n") };
}

interface PageOptions {
  url?: string;
  /** The page's scripts; Vite's client by default. */
  head?: string;
  /** The Sidebar module's URL in the stacks (an HMR update adds `?t=`). */
  sidebarUrl?: string;
}

/** The example's sidebar badge «3», with its fibers as React 19 leaves them. */
function badgePage(options: PageOptions = {}): Element {
  const dom = new JSDOM(`<head>${options.head ?? `<script type="module" src="/@vite/client"></script>`}</head><body><nav><span class="badge">3</span></nav></body>`, {
    url: options.url ?? `${ORIGIN}/`,
  });
  const sidebarUrl = options.sidebarUrl ?? `${ORIGIN}/src/components/Sidebar.tsx`;
  const app = { tag: 0, type: function App() {}, _debugOwner: null, _debugStack: stack(`${ORIGIN}/src/main.tsx:6:116`) };
  const sidebar = { tag: 0, type: function Sidebar() {}, _debugOwner: app, _debugStack: stack(`App (${ORIGIN}/src/App.tsx:13:30)`, BOTTOM) };
  const host = { tag: 5, type: "span", _debugOwner: sidebar, _debugStack: stack(`${sidebarUrl}:29:59`, "Array.map (<anonymous>)", `Sidebar (${sidebarUrl}:17:43)`, BOTTOM) };
  const span = dom.window.document.querySelector(".badge") as Element;
  (span as unknown as Record<string, unknown>)["__reactFiber$vite"] = host;
  return span;
}

/** A Vite dev server serving `modules` by path (the query is ignored, as Vite does); records every request. */
function devServer(modules: Record<string, string> = MODULES): { fetch: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.href);
    const text = url.origin === ORIGIN ? modules[url.pathname] : undefined;
    return text === undefined ? new Response("not found", { status: 404 }) : new Response(text, { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

const FILES_ONLY = {
  component: { framework: "react", name: "Sidebar", file: "src/components/Sidebar.tsx" },
  renderedBy: [
    { component: "Sidebar", file: "src/App.tsx" },
    { component: "App", file: "src/main.tsx" },
  ],
};
const WITH_LINES = {
  component: { framework: "react", name: "Sidebar", file: "src/components/Sidebar.tsx", line: 26, column: 44 },
  renderedBy: [
    { component: "Sidebar", file: "src/App.tsx", line: 12, column: 7 },
    { component: "App", file: "src/main.tsx", line: 7, column: 5 },
  ],
};

describe("React 19 on Vite: lines from the served modules' inline source maps", () => {
  it("gives files at the gesture, as before, and their source lines once the modules are read", async () => {
    const span = badgePage();
    expect(readFrameworkInfo(span)).toEqual(FILES_ONLY);
    const server = devServer();
    expect(await refineFrameworkInfo(span, server.fetch)).toEqual(WITH_LINES);
    // The modules of the call sites, from the page's own origin, each once.
    expect(server.requests.sort()).toEqual([`${ORIGIN}/src/App.tsx`, `${ORIGIN}/src/components/Sidebar.tsx`, `${ORIGIN}/src/main.tsx`]);
  });

  it("fetches a module updated by HMR at its URL, query included", async () => {
    const server = devServer();
    expect(await refineFrameworkInfo(badgePage({ sidebarUrl: `${ORIGIN}/src/components/Sidebar.tsx?t=1759130000000` }), server.fetch)).toEqual(WITH_LINES);
    expect(server.requests).toContain(`${ORIGIN}/src/components/Sidebar.tsx?t=1759130000000`);
  });

  it("reads a map served next to the module (a sourceMappingURL that is not inline)", async () => {
    const [code, inline] = MODULES["/src/components/Sidebar.tsx"].split("//# sourceMappingURL=data:application/json;base64,");
    const modules = { ...MODULES, "/src/components/Sidebar.tsx": `${code}//# sourceMappingURL=Sidebar.tsx.map\n`, "/src/components/Sidebar.tsx.map": atob(inline.trim()) };
    expect((await refineFrameworkInfo(badgePage(), devServer(modules).fetch)).component).toEqual(WITH_LINES.component);
  });

  it("stays silent where the map is missing, a module was edited since, or the map names another file", async () => {
    const sidebar = MODULES["/src/components/Sidebar.tsx"];
    const noMap = sidebar.slice(0, sidebar.lastIndexOf("//# sourceMappingURL="));
    const edited = `// a line added since the badge was rendered\n${sidebar}`;
    const [code, inline] = sidebar.split("//# sourceMappingURL=data:application/json;base64,");
    const otherFile = `${code}//# sourceMappingURL=data:application/json;base64,${btoa(atob(inline.trim()).replace('"sources":["Sidebar.tsx"]', '"sources":["NavList.tsx"]'))}\n`;
    for (const module of [noMap, edited, otherFile, "<!doctype html><html></html>"]) {
      const info = await refineFrameworkInfo(badgePage(), devServer({ ...MODULES, "/src/components/Sidebar.tsx": module }).fetch);
      // Only the Sidebar module's line goes; the chain keeps its lines from the other modules.
      expect(info).toEqual({ ...WITH_LINES, component: FILES_ONLY.component });
    }
    // Nothing served: every file stays without its line.
    expect(await refineFrameworkInfo(badgePage(), devServer({}).fetch)).toEqual(FILES_ONLY);
  });

  it("fetches nothing on a page that is not Vite's, not on a local dev host, or for another origin's modules", async () => {
    for (const page of [badgePage({ head: "" }), badgePage({ url: "https://shop.example.com/" })]) {
      const server = devServer();
      expect(await refineFrameworkInfo(page, server.fetch)).toEqual(FILES_ONLY);
      expect(server.requests).toEqual([]);
    }
    const server = devServer();
    const info = await refineFrameworkInfo(badgePage({ sidebarUrl: "http://localhost:5174/src/components/Sidebar.tsx" }), server.fetch);
    expect(info.component).toEqual(FILES_ONLY.component);
    expect(server.requests).not.toContain("http://localhost:5174/src/components/Sidebar.tsx");
  });

  it("past the time budget, the files stay without lines", async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    expect(await refineFrameworkInfo(badgePage(), hanging, 50)).toEqual(FILES_ONLY);
  });
});

describe("react-stack.ts: Vite's served modules", () => {
  it("recognizes a Vite dev page by its client script on its own origin", () => {
    expect(isViteDevPage([`${ORIGIN}/@vite/client`], ORIGIN)).toBe(true);
    expect(isViteDevPage([`${ORIGIN}/app/@vite/client`], ORIGIN)).toBe(true);
    expect(isViteDevPage(["http://localhost:5174/@vite/client", `${ORIGIN}/src/main.tsx`], ORIGIN)).toBe(false);
    expect(isViteDevPage([], ORIGIN)).toBe(false);
  });

  it("reads the map comment that ends a module: inline (base64 or percent-encoded) or a URL of the same origin", () => {
    const json = '{"version":3,"sources":["Ñandú.tsx"],"mappings":""}';
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    const url = `${ORIGIN}/src/Ñandú.tsx`;
    expect(sourceMapReference(`code;\n//# sourceMappingURL=data:application/json;base64,${base64}\n`, url)).toEqual({ kind: "inline", json });
    expect(sourceMapReference(`code;\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`, url)).toEqual({ kind: "inline", json });
    expect(sourceMapReference(`code;\n//# sourceMappingURL=data:application/json,${encodeURIComponent(json)}`, url)).toEqual({ kind: "inline", json });
    expect(sourceMapReference("code;\n//# sourceMappingURL=x.tsx.map", `${ORIGIN}/src/x.tsx?t=1`)).toEqual({ kind: "url", url: `${ORIGIN}/src/x.tsx.map` });
    expect(sourceMapReference("code;\n//# sourceMappingURL=http://evil.test/x.map", `${ORIGIN}/src/x.tsx`)).toBeUndefined();
    // Not at the end, not a comment, not JSON, not base64.
    expect(sourceMapReference("//# sourceMappingURL=x.map\ncode;", url)).toBeUndefined();
    expect(sourceMapReference('const s = "sourceMappingURL=x.map"', url)).toBeUndefined();
    expect(sourceMapReference("//# sourceMappingURL=data:text/plain;base64,e30=", url)).toBeUndefined();
    expect(sourceMapReference("//# sourceMappingURL=data:application/json;base64,%%%", url)).toBeUndefined();
    expect(sourceMapReference("code;", url)).toBeUndefined();
  });

  it("takes a map's source as the module's own file only when it is", () => {
    expect(isModuleSource("Sidebar.tsx", `${ORIGIN}/src/components/Sidebar.tsx?t=1`)).toBe(true);
    expect(isModuleSource("C:\\Users\\me\\app\\src\\components\\Sidebar.tsx", `${ORIGIN}/src/components/Sidebar.tsx`)).toBe(true);
    expect(isModuleSource("/home/me/app/src/components/Sidebar.tsx", `${ORIGIN}/src/components/Sidebar.tsx`)).toBe(true);
    expect(isModuleSource("y.tsx", `${ORIGIN}/@fs/C:/me/lib/y.tsx`)).toBe(true);
    expect(isModuleSource("C:/me/lib/y.tsx", `${ORIGIN}/@fs/C:/me/lib/y.tsx`)).toBe(true);
    expect(isModuleSource("NavList.tsx", `${ORIGIN}/src/components/Sidebar.tsx`)).toBe(false);
    expect(isModuleSource("../Sidebar.tsx", `${ORIGIN}/src/components/Sidebar.tsx`)).toBe(false);
    expect(isModuleSource("/home/me/app/src/other/Sidebar.tsx", `${ORIGIN}/src/components/Sidebar.tsx`)).toBe(false);
  });

  it("checks that the served code at a call site is a JSX call", () => {
    const text = MODULES["/src/components/Sidebar.tsx"];
    expect(isJsxCallAt(text, 29, 59)).toBe(true);
    expect(isJsxCallAt(text, 29, 58)).toBe(false);
    expect(isJsxCallAt("a;\n  React.createElement(X)", 2, 3)).toBe(true);
    expect(isJsxCallAt("one line", 5, 1)).toBe(false);
  });
});

describe("lacksLines: which React gestures ask the page again", () => {
  it("a chain not read yet (Next.js), or a file without its line (React 19 on Vite); not React 18's", () => {
    expect(lacksLines({ component: { framework: "react", name: "NavLink" } })).toBe(true);
    expect(lacksLines(FILES_ONLY)).toBe(true);
    expect(lacksLines({ component: FILES_ONLY.component, renderedBy: [] })).toBe(true);
    expect(lacksLines({ component: WITH_LINES.component, renderedBy: [{ file: "src/App.tsx" }] })).toBe(true);
    expect(lacksLines(WITH_LINES)).toBe(false);
    expect(lacksLines({ component: { framework: "react", name: "Row" }, renderedBy: [] })).toBe(false);
  });
});
