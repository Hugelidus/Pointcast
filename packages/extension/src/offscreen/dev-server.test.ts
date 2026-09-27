import { describe, expect, it } from "vitest";
import type { CapturedEvent, ElementInfo, SessionFile } from "@pointcast/core";
import { devServerReader, parseRawModule, resolveFromDevServer } from "./dev-server";

const ORIGIN = "http://localhost:5173";

/** The flowbite "Sales Report" link (Stage 0): written in ChartWidget, rendered by the shared More. */
const SALES_REPORT: ElementInfo = {
  tag: "a",
  text: "Sales Report",
  selector: "main > a",
  selectorUnique: true,
  path: "main › a",
  html: '<a href="#top">Sales Report</a>',
  component: { framework: "svelte", name: "More", file: "src/lib/More.svelte", line: 18 },
  renderedBy: [
    { component: "More", file: "src/lib/ChartWidget.svelte", line: 27 },
    { component: "ChartWidget", file: "src/routes/(sidebar)/+page.svelte", line: 14 },
  ],
};

const SOURCE: Record<string, string> = {
  "src/lib/More.svelte": '<script>\n  let { title } = $props();\n</script>\n<a href="#top">{title}</a>\n',
  "src/lib/ChartWidget.svelte": `${"<!-- -->\n".repeat(26)}<More title="Sales Report" />\n`,
  "src/routes/(sidebar)/+page.svelte": "<ChartWidget />\n",
};

function session(elements: ElementInfo[], url = `${ORIGIN}/`): SessionFile {
  const events: CapturedEvent[] = elements.map((element, i) => ({
    id: `e${i + 1}`,
    gesture: "point",
    tStart: 1_000 * i,
    tEnd: 1_000 * i,
    url,
    element,
  }));
  return {
    schemaVersion: 2,
    id: "s1",
    startedAt: "2026-09-27T10:00:00.000Z",
    t0: 0,
    durationMs: 5_000,
    recorder: { extensionVersion: "0.1.0", userAgent: "UA" },
    events,
  };
}

const rawModule = (text: string) => `export default ${JSON.stringify(text)}\n//# sourceMappingURL=data:application/json;base64,e30=`;

/**
 * A fake Vite dev server: /@vite/client, and `<path>?raw` for every file in `files`, as Vite
 * answers it. `hang` never answers the paths it matches (until the request is aborted).
 */
function viteServer(files: Record<string, string>, options: { vite?: boolean; hang?: RegExp } = {}) {
  const requests: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}${url.search}`);
    if (options.hang?.test(url.pathname)) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (url.pathname === "/@vite/client") {
      return options.vite === false
        ? new Response("not found", { status: 404 })
        : new Response("console.log('[vite] connecting...')", { headers: { "content-type": "text/javascript" } });
    }
    const path = decodeURI(url.pathname.slice(1));
    const text = files[path];
    if (url.search !== "?raw" || text === undefined) return new Response("not found", { status: 404 });
    return new Response(rawModule(text), { headers: { "content-type": "text/javascript" } });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

describe("parseRawModule", () => {
  it("reads Vite's ?raw module, with or without a trailing semicolon or source map comment", () => {
    expect(parseRawModule(rawModule('a "quoted"\nline\t2'))).toBe('a "quoted"\nline\t2');
    expect(parseRawModule('export default "x";')).toBe("x");
    expect(parseRawModule('\nexport default "<a>é</a>"')).toBe("<a>é</a>");
  });

  it("refuses anything else: an SPA fallback page, a transformed module, a non-string export", () => {
    expect(parseRawModule("<!doctype html><html></html>")).toBeUndefined();
    expect(parseRawModule('import x from "./x";\nexport default "x"')).toBeUndefined();
    expect(parseRawModule("export default 42")).toBeUndefined();
    expect(parseRawModule('export default "unterminated')).toBeUndefined();
  });
});

describe("resolveFromDevServer", () => {
  it("resolves the chain from the source Vite serves, and asks for nothing but the chain's files", async () => {
    const server = viteServer(SOURCE);
    const { session: resolved, note } = await resolveFromDevServer(session([SALES_REPORT]), server);

    expect(resolved.events[0]?.element.resolved).toEqual([
      { kind: "text", file: "src/lib/ChartWidget.svelte", line: 27, via: "dev-server", snippet: '<More title="Sales Report" />' },
    ]);
    expect(note).toBe("Code pointer: 1 location found in the source the dev server serves.");
    // SvelteKit's "+page.svelte" goes unescaped: Vite's decodeURI would keep a "%2B".
    expect(new Set(server.requests)).toEqual(
      new Set(["/@vite/client", "/src/lib/More.svelte?raw", "/src/lib/ChartWidget.svelte?raw", "/src/routes/(sidebar)/+page.svelte?raw"]),
    );
  });

  it("finds a monorepo package's root by dropping leading segments, then keeps that prefix", async () => {
    const inPackage: ElementInfo = {
      ...SALES_REPORT,
      component: { framework: "svelte", name: "More" },
      renderedBy: [
        { component: "More", file: "apps/web/src/lib/ChartWidget.svelte", line: 27 },
        { component: "ChartWidget", file: "apps/web/src/routes/(sidebar)/+page.svelte", line: 14 },
      ],
    };
    const server = viteServer(SOURCE);
    const { session: resolved } = await resolveFromDevServer(session([inPackage]), server);

    expect(resolved.events[0]?.element.resolved).toEqual([
      { kind: "text", file: "apps/web/src/lib/ChartWidget.svelte", line: 27, via: "dev-server", snippet: '<More title="Sales Report" />' },
    ]);
    const raw = server.requests.filter((request) => request.endsWith("?raw"));
    // Tried as is, then without "apps/", then without "apps/web/"; never more than two dropped.
    expect(raw).toContain("/apps/web/src/lib/ChartWidget.svelte?raw");
    expect(raw).toContain("/web/src/lib/ChartWidget.svelte?raw");
    expect(raw).toContain("/src/lib/ChartWidget.svelte?raw");
    expect(raw).not.toContain("/lib/ChartWidget.svelte?raw");

    // Once a file was found, the next path goes straight to that prefix: one request, even for
    // the resolver's import probes that do not exist.
    const reader = devServerReader(ORIGIN, server.fetch, new AbortController().signal);
    await reader.read("apps/web/src/lib/ChartWidget.svelte");
    server.requests.length = 0;
    expect(await reader.read("apps/web/src/lib/data/missing.ts")).toBeUndefined();
    expect(server.requests).toEqual(["/src/lib/data/missing.ts?raw"]);
    expect(reader.failure()).toBeUndefined();
  });

  it("leaves the session as it was when the files are not on the server (404)", async () => {
    const input = session([SALES_REPORT]);
    const { session: resolved, note } = await resolveFromDevServer(input, viteServer({}));
    expect(resolved).toEqual(input);
    expect(note).toBe("Code pointer: dev server source not available (it did not serve the files the page names).");
  });

  it("does not read source from a server that is not Vite, even one that answers every path", async () => {
    const input = session([SALES_REPORT]);
    const plain = await resolveFromDevServer(input, viteServer(SOURCE, { vite: false }));
    expect(plain.session).toEqual(input);
    expect(plain.note).toBe("Code pointer: dev server source not available (not a Vite dev server).");

    const requests: string[] = [];
    const spaFallback = (async (url: RequestInfo | URL) => {
      requests.push(String(url));
      return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    expect((await resolveFromDevServer(input, { fetch: spaFallback })).note).toContain("not a Vite dev server");
    expect(requests).toEqual([`${ORIGIN}/@vite/client`]);
  });

  it("gives up at the time budget, and drops what was read when a read was cut short", async () => {
    const input = session([SALES_REPORT]);
    const started = Date.now();
    // More.svelte answers; the other two chain files never do. A partial read could make a
    // literal look unique, so nothing is resolved.
    const server = viteServer(SOURCE, { hang: /ChartWidget|page/ });
    const { session: resolved, note } = await resolveFromDevServer(input, { ...server, budgetMs: 50 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(resolved).toEqual(input);
    expect(note).toBe("Code pointer: dev server source not available (no answer in time).");

    const silent = viteServer(SOURCE, { hang: /./ });
    expect((await resolveFromDevServer(input, { ...silent, budgetMs: 50 })).note).toContain("no answer in time");
  });

  it("says when the dev server cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const input = session([SALES_REPORT]);
    const { session: resolved, note } = await resolveFromDevServer(input, { fetch: down });
    expect(resolved).toEqual(input);
    expect(note).toBe("Code pointer: dev server source not available (could not reach it).");
  });

  it("says nothing and fetches nothing when no element has a chain", async () => {
    const server = viteServer(SOURCE);
    const { renderedBy: _chain, ...plain } = SALES_REPORT;
    const input = session([plain]);
    expect(await resolveFromDevServer(input, server)).toEqual({ session: input });
    expect(server.requests).toEqual([]);
  });

  it("reports source that was read but gave no unambiguous location", async () => {
    const twice = { ...SOURCE, "src/lib/ChartWidget.svelte": '<More title="Sales Report" />\n<More title="Sales Report" />\n' };
    const { session: resolved, note } = await resolveFromDevServer(session([SALES_REPORT]), viteServer(twice));
    expect(resolved.events[0]?.element.resolved).toBeUndefined();
    expect(note).toBe("Code pointer: source read from the dev server; no unambiguous text location.");
  });
});
