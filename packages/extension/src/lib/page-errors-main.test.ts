// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeRequest,
  formatConsoleArgs,
  installPageErrors,
  MAX_PENDING,
  MAX_REPORTS,
  PAGE_ERRORS_CONTROL_EVENT,
  PAGE_ERRORS_REPORT_EVENT,
  PAGE_ERRORS_SESSION_KEY,
  REPEAT_MS,
  scriptLocation,
  type PageErrorReport,
  type PageWindow,
} from "./page-errors-main";

/**
 * The MAIN-world hook of debug capture (D13) in jsdom. jsdom has one JS world, so the test plays
 * the isolated half: it sends the control events and listens for the reports, through the DOM
 * only, as the two worlds do in Chrome.
 */

const ORIGIN = "http://localhost:5173";

interface Page {
  win: PageWindow;
  reports: PageErrorReport[];
  /** The console the page had before the hook: what the page's own logging must still reach. */
  consoleCalls: Array<{ method: string; args: unknown[] }>;
  clock: { now: number };
  start(): void;
  stop(): void;
}

function page(setup: (win: PageWindow) => void = () => undefined): Page {
  const dom = new JSDOM("<body><button id=b>Export</button></body>", { url: `${ORIGIN}/orders` });
  const win = dom.window as unknown as PageWindow;
  const consoleCalls: Page["consoleCalls"] = [];
  // A console of the page's own that records what reaches it (jsdom's would print).
  const pageConsole = {
    error: vi.fn((...args: unknown[]) => consoleCalls.push({ method: "error", args })),
    warn: vi.fn((...args: unknown[]) => consoleCalls.push({ method: "warn", args })),
    log: vi.fn((...args: unknown[]) => consoleCalls.push({ method: "log", args })),
  };
  Object.defineProperty(win, "console", { value: pageConsole, writable: true, configurable: true });
  setup(win);
  const clock = { now: 1_790_000_000_000 };
  installPageErrors(win, () => clock.now);
  const reports: PageErrorReport[] = [];
  win.addEventListener(PAGE_ERRORS_REPORT_EVENT, (event) => {
    reports.push(JSON.parse((event as CustomEvent<string>).detail) as PageErrorReport);
  });
  const send = (detail: string) => win.dispatchEvent(new win.CustomEvent(PAGE_ERRORS_CONTROL_EVENT, { detail }));
  return { win, reports, consoleCalls, clock, start: () => send("start"), stop: () => send("stop") };
}

function throwIn(win: PageWindow, error: unknown, message = "Uncaught Error"): void {
  win.dispatchEvent(
    new win.ErrorEvent("error", { error, message, filename: `${ORIGIN}/src/OrdersTable.tsx?t=17`, lineno: 31, colno: 7 }),
  );
}

function reject(win: PageWindow, reason: unknown): void {
  const event = new win.Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  win.dispatchEvent(event);
}

/** An Error whose stack is what Chrome gives for a Vite dev page. */
function pageError(message: string, name = "TypeError"): Error {
  const error = new Error(message);
  error.name = name;
  error.stack =
    `${name}: ${message}\n` +
    `    at OrdersTable (${ORIGIN}/src/components/OrdersTable.tsx?t=1727:31:7)\n` +
    `    at renderWithHooks (${ORIGIN}/node_modules/.vite/deps/react-dom.js?v=9a1:11548:26)\n` +
    `    at mountIndeterminateComponent (${ORIGIN}/node_modules/.vite/deps/react-dom.js?v=9a1:14926:21)\n` +
    `    at beginWork (${ORIGIN}/node_modules/.vite/deps/react-dom.js?v=9a1:15914:22)`;
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uncaught errors and unhandled rejections", () => {
  it("reports the error with its app source and its first frames, project-relative, without query", () => {
    const p = page();
    p.start();
    throwIn(p.win, pageError("Cannot read properties of undefined (reading 'map')"));
    expect(p.reports).toEqual([
      {
        kind: "error",
        message: "TypeError: Cannot read properties of undefined (reading 'map')",
        source: "src/components/OrdersTable.tsx:31:7",
        stack: [
          "OrdersTable (src/components/OrdersTable.tsx:31:7)",
          "renderWithHooks (node_modules/.vite/deps/react-dom.js:11548:26)",
          "mountIndeterminateComponent (node_modules/.vite/deps/react-dom.js:14926:21)",
        ],
        at: p.clock.now,
      },
    ]);
  });

  it("falls back to the event's file and line, and skips cross-origin 'Script error.'", () => {
    const p = page();
    p.start();
    p.win.dispatchEvent(new p.win.ErrorEvent("error", { message: "Uncaught boom", filename: `${ORIGIN}/src/main.ts?t=1`, lineno: 4, colno: 2 }));
    p.win.dispatchEvent(new p.win.ErrorEvent("error", { message: "Script error." }));
    expect(p.reports).toEqual([{ kind: "error", message: "boom", source: "src/main.ts:4:2", at: p.clock.now }]);
  });

  it("reports unhandled rejections, of Errors and of anything else", () => {
    const p = page();
    p.start();
    reject(p.win, pageError("Export failed", "Error"));
    p.clock.now += 1;
    reject(p.win, { status: 500, detail: "boom", nested: { a: 1 } });
    expect(p.reports.map(({ kind, message, source }) => ({ kind, message, source }))).toEqual([
      { kind: "rejection", message: "Error: Export failed", source: "src/components/OrdersTable.tsx:31:7" },
      { kind: "rejection", message: '{status: 500, detail: "boom", nested: {…}}', source: undefined },
    ]);
  });

  it("makes an absolute path in a stack project-relative (D8)", () => {
    const p = page();
    p.start();
    const error = new Error("x");
    error.stack = "Error: x\n    at load (file:///C:/Users/hugob/Desktop/my-app/src/api.ts:12:3)";
    throwIn(p.win, error);
    expect(p.reports[0]?.source).toBe("src/api.ts:12:3");
    expect(JSON.stringify(p.reports)).not.toContain("hugob");
  });
});

describe("console.error and console.warn", () => {
  it("reports the message and still logs it, with the same arguments and this", () => {
    const p = page();
    p.start();
    const detail = { status: 500 };
    p.win.console.error("Export failed: %s (%d)", "server", 500, detail);
    p.win.console.warn("%cStyled", "color: red", "warning");
    p.win.console.log("not captured");
    expect(p.reports.map(({ kind, message }) => ({ kind, message }))).toEqual([
      { kind: "console-error", message: "Export failed: server (500) {status: 500}" },
      { kind: "console-warn", message: "Styled warning" },
    ]);
    expect(p.consoleCalls).toEqual([
      { method: "error", args: ["Export failed: %s (%d)", "server", 500, detail] },
      { method: "warn", args: ["%cStyled", "color: red", "warning"] },
      { method: "log", args: ["not captured"] },
    ]);
  });

  it("names where it was logged from: the caller, not the hook", () => {
    const p = page();
    p.start();
    p.win.console.error("from the test");
    // In jsdom the caller is this test file: what matters is that it is not the hook's own file.
    expect(p.reports[0]?.source).toMatch(/page-errors-main\.test\.ts:\d+:\d+$/);
  });

  it("does not report again what the page logs while a report is built (no recursion)", () => {
    const p = page();
    p.start();
    const sneaky = {
      toString() {
        p.win.console.error("logged from toString");
        return "x";
      },
    };
    // A string with a %s makes the hook format the object; its toString logs again.
    p.win.console.error("value: %s", { get a() { p.win.console.error("from a getter"); return 1; } });
    p.win.console.error(String(sneaky));
    expect(p.reports.map((r) => r.message)).toEqual(["value: {a: 1}", "logged from toString", "x"]);
  });

  it("passes a throwing console through unchanged, and the page keeps working", () => {
    const p = page((win) => {
      (win.console as unknown as Record<string, unknown>).error = () => {
        throw new Error("the page's console throws");
      };
    });
    p.start();
    expect(() => p.win.console.error("x")).toThrow("the page's console throws");
    expect(p.reports).toHaveLength(1);
  });
});

describe("failed requests", () => {
  function withFetch(respond: (url: string) => Promise<Response>) {
    return page((win) => {
      win.fetch = vi.fn((input: RequestInfo | URL) => respond(String(input))) as typeof win.fetch;
    });
  }

  it("reports a fetch with status >= 400: method, path, query names only; nothing for 2xx", async () => {
    const p = withFetch(async (url) => new Response("", { status: url.includes("export") ? 500 : 200 }));
    p.start();
    const failed = await p.win.fetch("/api/export?token=abc123&format=csv#x", { method: "post" });
    expect(failed.status).toBe(500);
    expect((await p.win.fetch("/api/orders")).status).toBe(200);
    expect(p.reports).toEqual([
      {
        kind: "network",
        message: "POST /api/export?token&format → 500",
        request: { method: "POST", url: "/api/export?token&format", status: 500 },
        at: p.clock.now,
      },
    ]);
  });

  it("reports a network failure, rethrows it unchanged, and ignores an abort", async () => {
    const failure = new TypeError("Failed to fetch");
    const p = withFetch(async (url) => {
      if (url.includes("abort")) throw new DOMException("aborted", "AbortError");
      throw failure;
    });
    p.start();
    await expect(p.win.fetch("https://api.example.com/v1/orders?page=2")).rejects.toBe(failure);
    await expect(p.win.fetch("/abort")).rejects.toThrow("aborted");
    expect(p.reports.map((r) => r.message)).toEqual(["GET api.example.com/v1/orders?page → failed (TypeError: Failed to fetch)"]);
  });

  it("passes a synchronous throw of fetch through, and returns fetch's own promise when idle", async () => {
    const p = page((win) => {
      win.fetch = vi.fn(() => {
        throw new TypeError("bad arguments");
      }) as typeof win.fetch;
    });
    p.start();
    expect(() => p.win.fetch("/x")).toThrow("bad arguments");
  });

  it("reports failed XMLHttpRequests, without reading their bodies", () => {
    const sent: FakeXhr[] = [];
    class FakeXhr extends EventTarget {
      status = 0;
      open(_method: string, _url: string): void {}
      send(_body?: unknown): void {
        sent.push(this);
      }
    }
    const p = page((win) => {
      (win as unknown as Record<string, unknown>).XMLHttpRequest = FakeXhr;
    });
    p.start();
    const Xhr = (p.win as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest;
    const ok = new Xhr();
    ok.open("GET", "/api/orders?status=open");
    ok.send();
    const failed = new Xhr();
    failed.open("delete", "/api/orders/7");
    failed.send();
    const lost = new Xhr();
    lost.open("GET", "http://other.test/feed");
    lost.send();
    const [first, second, third] = sent;
    first!.status = 200;
    first!.dispatchEvent(new Event("load"));
    second!.status = 404;
    second!.dispatchEvent(new Event("load"));
    third!.dispatchEvent(new Event("error"));
    expect(p.reports.map((r) => r.message)).toEqual(["DELETE /api/orders/7 → 404", "GET other.test/feed → failed"]);
  });
});

describe("lifecycle, caps and the page's own hooks", () => {
  it("hooks nothing until started, and restores every original at stop", () => {
    const fetchFn = vi.fn(async () => new Response(""));
    const p = page((win) => {
      win.fetch = fetchFn as unknown as typeof win.fetch;
    });
    const originalError = p.win.console.error;
    const originalOpen = p.win.XMLHttpRequest.prototype.open;
    expect(p.win.fetch).toBe(fetchFn);
    p.win.console.error("before");
    p.start();
    expect(p.win.fetch).not.toBe(fetchFn);
    expect(p.win.console.error).not.toBe(originalError);
    expect(p.win.XMLHttpRequest.prototype.open).not.toBe(originalOpen);
    p.stop();
    expect(p.win.fetch).toBe(fetchFn);
    expect(p.win.console.error).toBe(originalError);
    expect(p.win.XMLHttpRequest.prototype.open).toBe(originalOpen);
    p.win.console.error("after");
    throwIn(p.win, pageError("after"));
    expect(p.reports).toEqual([]);
  });

  it("leaves a wrapper the page wrapped again in place, inert", () => {
    const p = page();
    p.start();
    const ours = p.win.console.error;
    const theirs = (...args: unknown[]) => ours(...args);
    p.win.console.error = theirs;
    p.stop();
    expect(p.win.console.error).toBe(theirs);
    p.win.console.error("still logged");
    expect(p.reports).toEqual([]);
    expect(p.consoleCalls.map((c) => c.args[0])).toEqual(["still logged"]);
  });

  it("drops the same error repeated within REPEAT_MS, and stops at MAX_REPORTS", () => {
    const p = page();
    p.start();
    p.win.console.error("loop");
    p.clock.now += REPEAT_MS - 1;
    p.win.console.error("loop");
    p.clock.now += 1;
    p.win.console.error("loop");
    expect(p.reports).toHaveLength(2);
    for (let i = 0; i < MAX_REPORTS + 20; i++) p.win.console.error(`error ${i}`);
    expect(p.reports).toHaveLength(MAX_REPORTS);
    expect(p.consoleCalls).toHaveLength(MAX_REPORTS + 23);
  });

  it("starts from the tab's sessionStorage flag and keeps what fails until the isolated half connects", () => {
    const p = page((win) => win.sessionStorage.setItem(PAGE_ERRORS_SESSION_KEY, "1"));
    for (let i = 0; i < MAX_PENDING + 5; i++) p.win.console.error(`early ${i}`);
    expect(p.reports).toEqual([]);
    p.start();
    expect(p.reports).toHaveLength(MAX_PENDING);
    expect(p.reports[0]?.message).toBe("early 5");
    p.win.console.error("live");
    expect(p.reports.at(-1)?.message).toBe("live");
  });

  it("installs once per window", () => {
    const p = page();
    expect(installPageErrors(p.win)).toBe(installPageErrors(p.win));
  });
});

describe("helpers", () => {
  it("formats console arguments like a log line", () => {
    expect(formatConsoleArgs([])).toBe("");
    expect(formatConsoleArgs(["100%% done %o", [1, 2], null])).toBe("100% done [Array(2)] null");
    expect(formatConsoleArgs([new RangeError("bad")])).toBe("RangeError: bad");
    expect(formatConsoleArgs(["%s"])).toBe("%s");
  });

  it("describes script and request locations", () => {
    expect(scriptLocation(`${ORIGIN}/src/App.tsx?t=1`, ORIGIN)).toBe("src/App.tsx");
    expect(scriptLocation(`${ORIGIN}/@fs/C:/Users/me/app/src/lib/x.ts`, ORIGIN)).toBe("src/lib/x.ts");
    expect(scriptLocation("https://cdn.example.com/lib.js", ORIGIN)).toBe("cdn.example.com/lib.js");
    expect(describeRequest(new URL(`${ORIGIN}/api/a?x=1`), undefined, ORIGIN)).toEqual({ method: "GET", url: "/api/a?x" });
    expect(describeRequest({ url: `${ORIGIN}/api/b`, method: "PUT" }, undefined, ORIGIN)).toEqual({ method: "PUT", url: "/api/b" });
    expect(describeRequest("data:text/plain,secret", undefined, ORIGIN)).toEqual({ method: "GET", url: "data:…" });
  });
});
