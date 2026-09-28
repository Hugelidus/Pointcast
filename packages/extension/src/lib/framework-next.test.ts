// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { requestRefinedFrameworkInfo } from "./component-bridge";
import { installComponentBridge, readComponent, readFrameworkInfo, readRenderedBy, refineFrameworkInfo } from "./framework-main";
import { mappedKind, nextBasePath, projectRootOf, reactCallSite, serverFile, sourceFile } from "./react-stack";
import { mapLines } from "./test-utils/source-map-encode";

/**
 * React 19 under Next.js 16 (App Router, Turbopack dev), with the stack and map shapes recorded on
 * dev/examples/next-dashboard (D9 note 2026-09-28), on a smaller project at C:\Users\me\shop.
 */
const ORIGIN = "http://localhost:3000";
const CHUNKS = `${ORIGIN}/_next/static/chunks`;
const SERVER_FILE = "C:\\Users\\me\\shop\\.next\\dev\\server\\chunks\\ssr\\_15w6fn-._.js";
const SERVER_URL = `about://React/Server/${encodeURI(SERVER_FILE)}`;
const ROOT = "file:///C:/Users/me/shop";

function stack(...frames: string[]): { stack: string } {
  return { stack: ["Error: react-stack-top-frame", ...frames.map((frame) => `    at ${frame}`)].join("\n") };
}
const clientJsx = `exports.jsxDEV (${CHUNKS}/14ei_next_0os_t-p._.js:1950:33)`;
const serverJsx = `fakeJSXCallSite (${CHUNKS}/14ei_next_dist_compiled_react-server-dom-turbopack_09vo7j6._.js:2001:21)`;
const bottom = `Object.react_stack_bottom_frame (${CHUNKS}/14ei_next_dist_compiled_react-server-dom-turbopack_09vo7j6._.js:2768:93)`;

/** The badge «12» of the sidebar: written in the client NavLink, which the server Sidebar renders, in the root layout. */
function badgePage(): { doc: Document; span: Element } {
  const dom = new JSDOM(`<head><script src="/_next/static/chunks/main.js"></script></head><body><a href="/orders"><span>Orders</span><span class="badge">12</span></a></body>`, {
    url: `${ORIGIN}/`,
  });
  const doc = dom.window.document;
  const layout = { name: "RootLayout", env: "Server", key: null, owner: null, debugStack: stack(serverJsx, "Function.all (<anonymous>)") };
  const sidebar = { name: "Sidebar", env: "Server", key: null, owner: layout, debugStack: stack(serverJsx, `RootLayout (${SERVER_URL}?0:27:434)`, bottom) };
  const navLink = {
    tag: 0,
    type: function NavLink() {},
    _debugOwner: sidebar,
    _debugStack: stack(serverJsx, `<anonymous> (${SERVER_URL}?15:152:452)`, "Array.map (<anonymous>)", bottom),
  };
  const host = { tag: 5, type: "span", _debugOwner: navLink, _debugStack: stack(clientJsx, `NavLink (${CHUNKS}/components_nav-link_tsx_0t71wd7._.js:32:385)`, bottom) };
  const span = doc.querySelector(".badge") as Element;
  (span as unknown as Record<string, unknown>)["__reactFiber$abc"] = host;
  return { doc, span };
}

const MAPS: Record<string, unknown> = {
  [`${CHUNKS}/components_nav-link_tsx_0t71wd7._.js.map`]: {
    version: 3,
    sources: [],
    sections: [
      {
        offset: { line: 4, column: 0 },
        map: {
          version: 3,
          sources: [`${ROOT}/components/nav-link.tsx`],
          mappings: mapLines([{ line: 28, column: 380, source: 0, originalLine: 13, originalColumn: 16 }]),
        },
      },
    ],
  },
  [`${ORIGIN}/__nextjs_source-map?filename=${encodeURIComponent(SERVER_FILE)}`]: {
    version: 3,
    sources: [`${ROOT}/components/sidebar.tsx`, `${ROOT}/app/layout.tsx`],
    mappings: mapLines([
      { line: 27, column: 430, source: 1, originalLine: 15, originalColumn: 11 },
      { line: 152, column: 450, source: 0, originalLine: 13, originalColumn: 15 },
    ]),
  },
};

/** A dev server that serves the maps above; records every request. */
function devServer(maps: Record<string, unknown> = MAPS): { fetch: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const map = maps[url];
    return map === undefined ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(map), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

describe("React 19 stacks under Next.js (react-stack.ts)", () => {
  it("takes the call site by React's own rule: after the JSX frame, before the bottom frame", () => {
    expect(reactCallSite(stack(clientJsx, `NavLink (${CHUNKS}/c._.js:32:385)`, bottom).stack)).toEqual({ url: `${CHUNKS}/c._.js`, line: 32, column: 385 });
    expect(reactCallSite(stack(serverJsx, `Sidebar (${SERVER_URL}?10:141:426)`).stack)).toEqual({ url: `${SERVER_URL}?10`, line: 141, column: 426 });
    // A page rendered by the framework: no app call site.
    expect(reactCallSite(stack(serverJsx, "Function.all (<anonymous>)").stack)).toBeUndefined();
    expect(reactCallSite(stack(clientJsx, bottom).stack)).toBeUndefined();
  });

  it("tells Next's chunks and Server Component frames from Vite's modules", () => {
    expect(mappedKind(`${CHUNKS}/components_0d-2y94._.js`, ORIGIN)).toBe("next-chunk");
    expect(mappedKind(`${SERVER_URL}?3`, ORIGIN)).toBe("server");
    expect(mappedKind("http://localhost:5173/src/App.tsx", "http://localhost:5173")).toBeUndefined();
    expect(mappedKind(`http://elsewhere:3000/_next/static/chunks/x.js`, ORIGIN)).toBeUndefined();
    expect(serverFile(`${SERVER_URL}?10`)).toBe(SERVER_FILE);
    expect(projectRootOf(SERVER_FILE)).toBe("C:/Users/me/shop");
    expect(projectRootOf("/home/me/shop/.next/server/chunks/ssr/x.js")).toBe("/home/me/shop");
    expect(projectRootOf("/srv/app/dist/x.js")).toBeUndefined();
    expect(nextBasePath([`${ORIGIN}/docs/_next/static/chunks/main.js`], ORIGIN)).toBe("/docs");
    expect(nextBasePath(["http://localhost:5173/src/main.tsx"], ORIGIN)).toBeUndefined();
  });

  it("makes sources project-relative, never absolute, and only under the root", () => {
    const root = "C:/Users/me/shop";
    expect(sourceFile(`${ROOT}/components/nav-link.tsx`, root)).toEqual({ kind: "app", file: "components/nav-link.tsx" });
    expect(sourceFile("file:///c:/Users/me/shop/app/page.tsx", root)).toEqual({ kind: "app", file: "app/page.tsx" });
    expect(sourceFile(`${ROOT}/node_modules/.pnpm/next@16/node_modules/next/dist/client/app-dir/link.js`, root)).toMatchObject({ kind: "library" });
    expect(sourceFile("turbopack:///[project]/components/x.tsx", undefined)).toEqual({ kind: "app", file: "components/x.tsx" });
    // Outside the root (another package of a monorepo), or no root known: nothing to vouch for.
    expect(sourceFile("file:///C:/Users/me/other/ui/button.tsx", root)).toBeUndefined();
    expect(sourceFile(`${ROOT}/components/nav-link.tsx`, undefined)).toBeUndefined();
    expect(sourceFile("webpack://_N_E/./components/x.tsx", root)).toBeUndefined();
  });
});

describe("the component bridge on a Next.js page", () => {
  it("names the owner at the gesture, and reads no chain without source maps", () => {
    const { span } = badgePage();
    expect(readComponent(span)).toEqual({ framework: "react", name: "NavLink" });
    expect(readRenderedBy(span)).toBeUndefined();
    expect(readFrameworkInfo(span)).toEqual({ component: { framework: "react", name: "NavLink" } });
  });

  it("maps the element and its owners, Server Components included, through the dev server's maps", async () => {
    const { span } = badgePage();
    const server = devServer();
    expect(await refineFrameworkInfo(span, server.fetch)).toEqual({
      component: { framework: "react", name: "NavLink", file: "components/nav-link.tsx", line: 13, column: 16 },
      renderedBy: [
        { component: "NavLink", file: "components/sidebar.tsx", line: 13, column: 15 },
        { component: "Sidebar", file: "app/layout.tsx", line: 15, column: 11 },
      ],
    });
    // Only the page's own origin, one request per map; nothing absolute leaves but to the dev server.
    expect(server.requests.every((url) => url.startsWith(`${ORIGIN}/`))).toBe(true);
    expect(new Set(server.requests).size).toBe(server.requests.length);
  });

  it("ends the chain where a map is missing, instead of moving the next frame up", async () => {
    const { span } = badgePage();
    const clientOnly = devServer({ [`${CHUNKS}/components_nav-link_tsx_0t71wd7._.js.map`]: MAPS[`${CHUNKS}/components_nav-link_tsx_0t71wd7._.js.map`] });
    // The element's own line is known; its owners are not: no chain, and not an empty one either.
    expect(await refineFrameworkInfo(span, clientOnly.fetch)).toEqual({
      component: { framework: "react", name: "NavLink", file: "components/nav-link.tsx", line: 13, column: 16 },
    });
  });

  it("says the chain is empty for a page's own markup (the framework renders the page)", async () => {
    const dom = new JSDOM(`<head><script src="/_next/static/chunks/main.js"></script></head><body><h1>Overview</h1></body>`, { url: `${ORIGIN}/` });
    const page = { name: "OverviewPage", env: "Server", key: null, owner: null, debugStack: stack(serverJsx, "Function.all (<anonymous>)") };
    const h1 = dom.window.document.querySelector("h1") as Element;
    (h1 as unknown as Record<string, unknown>)["__reactFiber$abc"] = {
      tag: 5,
      type: "h1",
      _debugOwner: page,
      _debugStack: stack(serverJsx, `OverviewPage (${SERVER_URL}?21:30:426)`, bottom),
    };
    const server = devServer({
      [`${ORIGIN}/__nextjs_source-map?filename=${encodeURIComponent(SERVER_FILE)}`]: {
        version: 3,
        sources: [`${ROOT}/app/page.tsx`],
        mappings: mapLines([{ line: 30, column: 420, source: 0, originalLine: 10, originalColumn: 7 }]),
      },
    });
    expect(await refineFrameworkInfo(h1, server.fetch)).toEqual({
      component: { framework: "react", name: "OverviewPage", file: "app/page.tsx", line: 10, column: 7 },
      renderedBy: [],
    });
  });

  it("answers the isolated side's asynchronous request with a string event", async () => {
    const { doc, span } = badgePage();
    const win = doc.defaultView as unknown as Window & { fetch: typeof fetch };
    win.fetch = devServer().fetch;
    installComponentBridge(win);
    const info = await requestRefinedFrameworkInfo(span, 2_000);
    expect(info.renderedBy?.map((frame) => `${frame.file}:${frame.line}`)).toEqual(["components/sidebar.tsx:13", "app/layout.tsx:15"]);
    expect(info.component?.file).toBe("components/nav-link.tsx");
  });

  it("gives {} when nobody answers the asynchronous request", async () => {
    const dom = new JSDOM("<body><p>x</p></body>", { url: `${ORIGIN}/` });
    expect(await requestRefinedFrameworkInfo(dom.window.document.querySelector("p") as Element, 50)).toEqual({});
  });
});
