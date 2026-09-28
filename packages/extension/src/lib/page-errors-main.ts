import { ERROR_MESSAGE_MAX_CHARS, ERROR_STACK_MAX, projectRelativePath } from "@pointcast/core";
import { withoutQueryValues } from "./page-errors-shared";

/**
 * MAIN-world half of debug capture (D13): what failed on the page while recording. Runs in the
 * page's own JS world (like framework-main.ts), because only there are the page's exceptions,
 * console and network visible; the isolated-world half (content/page-errors.ts) redacts what this
 * reports and sends it to the recorder.
 *
 * Protocol (DOM events carry strings, which both worlds can read):
 * - isolated → MAIN: `CustomEvent(PAGE_ERRORS_CONTROL_EVENT, { detail: "start" | "stop" })` on window.
 *   "start" hooks the page (if not hooked yet) and connects: reports are dispatched from then on,
 *   after the ones kept while nobody listened. "stop" unhooks and forgets everything.
 * - MAIN → isolated: `CustomEvent(PAGE_ERRORS_REPORT_EVENT, { detail: <JSON of a PageErrorReport> })`.
 * - While a recording runs, the isolated half also sets PAGE_ERRORS_SESSION_KEY in the tab's
 *   sessionStorage: a page loaded during the recording is then hooked at document_start, before
 *   its first request, and what fails before the isolated half starts (document_idle) is kept
 *   (at most MAX_PENDING) until it connects.
 *
 * Rules: the page must never notice. Hooks are installed only while recording and removed after
 * (unless the page wrapped them again meanwhile, then they stay, inert); every original is called
 * with its own `this` and arguments and its result or exception is passed through untouched; a
 * console call made while a report is being built (a page toString that logs) is not reported
 * again; every step is in try/catch; no request or response body or header is ever read.
 */

export const PAGE_ERRORS_CONTROL_EVENT = "pointcast:page-errors-control";
export const PAGE_ERRORS_REPORT_EVENT = "pointcast:page-errors-report";
export const PAGE_ERRORS_SESSION_KEY = "pointcast:page-errors";

/** What the MAIN world reports; the isolated half checks it with core's parseCapturedErrorDraft. */
export interface PageErrorReport {
  kind: "error" | "rejection" | "console-error" | "console-warn" | "network";
  message: string;
  source?: string;
  stack?: string[];
  request?: { method: string; url: string; status: number };
  /** Date.now() when it happened (D6: one clock for every context). */
  at: number;
}

/** Reports per page and recording: an error loop must not flood the recorder. */
export const MAX_REPORTS = 100;
/** The same error again within this time is not reported again. */
export const REPEAT_MS = 2000;
/** Kept while the isolated half is not listening yet (a page loading during a recording). */
export const MAX_PENDING = 50;
/** A formatted console argument; the message is cut to ERROR_MESSAGE_MAX_CHARS anyway. */
const ARGUMENT_MAX_CHARS = ERROR_MESSAGE_MAX_CHARS;

export interface PageErrorsHook {
  /** Hooks the page (idempotent); reports are kept until connect(). */
  start(): void;
  /** Reports are dispatched from now on, starting with the kept ones. */
  connect(): void;
  /** Unhooks and forgets. */
  stop(): void;
  readonly active: boolean;
}

const INSTALLED = Symbol.for("pointcast.pageErrors");

/** A window with its globals (console, fetch, XMLHttpRequest, CustomEvent): the page's or a jsdom one. */
export type PageWindow = Window & typeof globalThis;

type Loose = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// ------------------------------------------------------------------------------ formatting

/** An Error from any realm (duck-typed: instanceof fails across iframes and worlds). */
function errorText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const error = value as Loose;
  const message = error.message;
  if (typeof message !== "string" || typeof error.stack !== "string") return undefined;
  const name = str(error.name) ?? "Error";
  return message === "" ? name : `${name}: ${message}`;
}

/** A short, safe rendering of one console argument: never deep, never a page getter chain. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, ARGUMENT_MAX_CHARS);
  if (value === null || value === undefined) return String(value);
  if (typeof value === "function") return `[function ${str((value as { name?: unknown }).name) ?? "anonymous"}]`;
  if (typeof value !== "object") return String(value).slice(0, ARGUMENT_MAX_CHARS);
  const error = errorText(value);
  if (error !== undefined) return error.slice(0, ARGUMENT_MAX_CHARS);
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  const node = value as { nodeType?: unknown; nodeName?: unknown };
  if (typeof node.nodeType === "number" && typeof node.nodeName === "string") return `<${node.nodeName.toLowerCase()}>`;
  // A plain object: its first few primitive own properties, as a log line would show them.
  const entries: string[] = [];
  for (const key of Object.keys(value).slice(0, 6)) {
    const item = (value as Loose)[key];
    const shown =
      typeof item === "string" ? JSON.stringify(item.slice(0, 80)) : typeof item === "object" && item !== null ? "{…}" : String(item);
    entries.push(`${key}: ${shown}`);
  }
  return `{${entries.join(", ")}}`.slice(0, ARGUMENT_MAX_CHARS);
}

/** console.error's arguments as one line, with printf-style substitutions ("%s", "%o", "%c"). */
export function formatConsoleArgs(args: readonly unknown[]): string {
  if (args.length === 0) return "";
  const parts: string[] = [];
  let next = 1;
  const first = args[0];
  if (typeof first === "string" && first.includes("%")) {
    parts.push(
      first.replace(/%[sdifoOc%]/g, (token) => {
        if (token === "%%") return "%";
        if (next >= args.length) return token;
        const value = args[next++];
        return token === "%c" ? "" : describeValue(value);
      }),
    );
  } else {
    parts.push(describeValue(first));
  }
  for (const value of args.slice(next)) parts.push(describeValue(value));
  return parts.join(" ");
}

// ------------------------------------------------------------------------------ locations

/**
 * A script or request URL as the agent needs it: the path of the page's own origin without its
 * leading "/" ("src/components/OrdersTable.tsx"), or host + path for another origin, never the
 * query or fragment (Vite's "?t=…" cache busters, and whatever else a URL carries). A file:// URL
 * or Vite's "/@fs/<absolute path>" is made project-relative (D8).
 */
export function scriptLocation(raw: string, pageOrigin: string): string {
  // A Windows path ("C:\…" parses as a URL with scheme "c:").
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return projectRelativePath(raw.split("?")[0] ?? raw);
  let url: URL;
  try {
    url = new URL(raw, pageOrigin);
  } catch {
    return projectRelativePath(raw.split(/[?#]/)[0] ?? raw);
  }
  if (url.protocol === "file:") return projectRelativePath(`file://${url.pathname}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol.replace(/:$/, "");
  const path = decodeSafely(url.pathname);
  if (url.origin !== pageOrigin) return `${url.host}${path}`;
  const local = path.replace(/^\//, "");
  return local.startsWith("@fs/") ? projectRelativePath(local.slice(4)) : projectRelativePath(local);
}

function decodeSafely(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

interface Frame {
  name?: string;
  location: string;
}

const FRAME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** The URL of the script this code runs from, without query: its frames are never the page's. */
const OWN_SCRIPT = ((): string | undefined => {
  for (const line of (new Error().stack ?? "").split("\n")) {
    const url = FRAME.exec(line)?.[2];
    if (url) return url.split("?")[0];
  }
  return undefined;
})();

/** Frames of a V8 stack ("    at fn (url:1:2)" / "    at url:1:2"), without the extension's own. */
export function parseStack(stack: unknown, pageOrigin: string): Frame[] {
  if (typeof stack !== "string") return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(0, 30)) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, name, url = "", lineNo, column] = match;
    if (/^(chrome|moz)-extension:/.test(url) || url.split("?")[0] === OWN_SCRIPT) continue;
    const where = scriptLocation(url.replace(/^async /, ""), pageOrigin);
    frames.push({ ...(name ? { name: name.replace(/^async /, "") } : {}), location: `${where}:${lineNo}:${column}` });
  }
  return frames;
}

/** The first frame in the app's own code (not a library in node_modules or a Vite dependency). */
function appFrame(frames: readonly Frame[]): Frame | undefined {
  return frames.find((frame) => !/(^|\/)(node_modules|\.vite)\//.test(frame.location)) ?? frames[0];
}

function stackFields(frames: readonly Frame[]): Pick<PageErrorReport, "source" | "stack"> {
  if (frames.length === 0) return {};
  const source = appFrame(frames)?.location;
  const stack = frames.slice(0, ERROR_STACK_MAX).map((frame) => (frame.name ? `${frame.name} (${frame.location})` : frame.location));
  return { ...(source ? { source } : {}), stack };
}

/** "POST", "/api/orders?status&page" for a fetch() or XMLHttpRequest.open() call. */
export function describeRequest(input: unknown, init: unknown, pageOrigin: string): { method: string; url: string } {
  let method = "GET";
  let raw = "";
  if (typeof input === "string") raw = input;
  else if (typeof input === "object" && input !== null) {
    const request = input as { url?: unknown; method?: unknown; href?: unknown };
    raw = str(request.url) ?? str(request.href) ?? String(input);
    method = str(request.method) ?? method;
  }
  const initMethod = typeof init === "object" && init !== null ? str((init as { method?: unknown }).method) : undefined;
  method = (initMethod ?? method).toUpperCase().slice(0, 16);
  return { method, url: requestLocation(raw, pageOrigin) };
}

function requestLocation(raw: string, pageOrigin: string): string {
  try {
    const url = new URL(raw, pageOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}…`;
    const where = url.origin === pageOrigin ? url.pathname : `${url.host}${url.pathname}`;
    return withoutQueryValues(`${where}${url.search}`);
  } catch {
    return withoutQueryValues(raw);
  }
}

// ------------------------------------------------------------------------------ the hook

/**
 * Installs the hook in `win` once (a second call returns the same one), listening for the
 * isolated half's control event. Starts at once when the tab's sessionStorage says a recording
 * is running.
 */
export function installPageErrors(win: PageWindow, now: () => number = () => Date.now()): PageErrorsHook {
  const holder = win as unknown as Record<symbol, PageErrorsHook | undefined>;
  const existing = holder[INSTALLED];
  if (existing) return existing;
  const hook = createHook(win, now);
  holder[INSTALLED] = hook;
  win.addEventListener(PAGE_ERRORS_CONTROL_EVENT, (event) => {
    const command = (event as CustomEvent<unknown>).detail;
    if (command === "start") {
      hook.start();
      hook.connect();
    } else if (command === "stop") hook.stop();
  });
  try {
    if (win.sessionStorage.getItem(PAGE_ERRORS_SESSION_KEY) === "1") hook.start();
  } catch {
    // Storage disabled or a sandboxed page: the isolated half starts it at document_idle.
  }
  return hook;
}

function createHook(win: PageWindow, now: () => number): PageErrorsHook {
  const origin = win.location.origin;
  let active = false;
  let connected = false;
  let busy = false;
  let reports = 0;
  let pending: string[] = [];
  const lastReported = new Map<string, number>();
  const undo: Array<() => void> = [];

  const dispatch = (json: string) => {
    win.dispatchEvent(new win.CustomEvent(PAGE_ERRORS_REPORT_EVENT, { detail: json }));
  };

  /** Builds and sends one report; `build` runs with re-entrance blocked and every error swallowed. */
  const report = (build: () => Omit<PageErrorReport, "at"> | undefined) => {
    if (!active || busy) return;
    busy = true;
    try {
      const found = build();
      if (found === undefined || found.message === "") return;
      const at = now();
      // The same message counts as a repeat wherever it comes from: a loop is what this is for.
      const key = `${found.kind}\u0000${found.message}`;
      const last = lastReported.get(key);
      if ((last !== undefined && at - last < REPEAT_MS) || reports >= MAX_REPORTS) return;
      lastReported.set(key, at);
      reports++;
      const json = JSON.stringify({ ...found, message: found.message.slice(0, ERROR_MESSAGE_MAX_CHARS * 2), at });
      if (connected) dispatch(json);
      else pending = [...pending, json].slice(-MAX_PENDING);
    } catch {
      // Never let reporting break the page.
    } finally {
      busy = false;
    }
  };

  const onError = (event: Event) => {
    report(() => {
      const e = event as ErrorEvent;
      const fromError = errorText(e.error);
      const message = fromError ?? str(e.message)?.replace(/^Uncaught /, "");
      // "Script error." from a cross-origin script without CORS: nothing to say.
      if (message === undefined || (message === "Script error." && !str(e.filename))) return undefined;
      const frames = parseStack((e.error as Loose | undefined)?.stack, origin);
      const fallback = str(e.filename) ? `${scriptLocation(e.filename, origin)}:${e.lineno}:${e.colno}` : undefined;
      const fields = stackFields(frames);
      return { kind: "error", message, ...fields, ...(fields.source ? {} : fallback ? { source: fallback } : {}) };
    });
  };

  const onRejection = (event: Event) => {
    report(() => {
      const reason = (event as PromiseRejectionEvent).reason;
      const message = errorText(reason) ?? describeValue(reason);
      return { kind: "rejection", message, ...stackFields(parseStack((reason as Loose | undefined)?.stack, origin)) };
    });
  };

  const wrapConsole = (method: "error" | "warn") => {
    const target = win.console as unknown as Record<string, unknown>;
    const original = target[method];
    if (typeof original !== "function") return;
    const kind = method === "error" ? "console-error" : "console-warn";
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      report(() => {
        // The caller's location: parseStack leaves out this script's own frames (the wrapper).
        const frames = parseStack(new Error().stack, origin);
        const source = appFrame(frames)?.location;
        return { kind, message: formatConsoleArgs(args), ...(source ? { source } : {}) };
      });
      return Reflect.apply(original as (...a: unknown[]) => unknown, this, args);
    };
    target[method] = wrapper;
    undo.push(() => {
      if (target[method] === wrapper) target[method] = original;
    });
  };

  const network = (method: string, url: string, status: number, detail?: string) => {
    report(() => ({
      kind: "network",
      message: `${method} ${url} → ${status === 0 ? `failed${detail ? ` (${detail})` : ""}` : status}`,
      request: { method, url, status },
    }));
  };

  const wrapFetch = () => {
    const original = win.fetch;
    if (typeof original !== "function") return;
    const wrapper = function (this: unknown, ...args: unknown[]): Promise<Response> {
      // Called first and as is: a synchronous throw reaches the page unchanged.
      const promise = Reflect.apply(original, this, args) as Promise<Response>;
      if (!active) return promise;
      let request: { method: string; url: string };
      try {
        request = describeRequest(args[0], args[1], origin);
      } catch {
        return promise;
      }
      // A promise of our own that settles like the page's: the page still gets its unhandled
      // rejection when it handles nothing, and never waits on our reporting.
      return promise.then(
        (response) => {
          try {
            if (response.status >= 400) network(request.method, request.url, response.status);
          } catch {
            // An odd Response: nothing to report.
          }
          return response;
        },
        (error: unknown) => {
          const name = (error as { name?: unknown } | null)?.name;
          if (name !== "AbortError") network(request.method, request.url, 0, errorText(error) ?? undefined);
          throw error;
        },
      );
    };
    win.fetch = wrapper as typeof win.fetch;
    undo.push(() => {
      if (win.fetch === (wrapper as typeof win.fetch)) win.fetch = original;
    });
  };

  const wrapXhr = () => {
    const proto = win.XMLHttpRequest?.prototype;
    if (!proto) return;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    const open = function (this: XMLHttpRequest, ...args: unknown[]): void {
      try {
        requests.set(this, describeRequest(String(args[1]), { method: String(args[0]) }, origin));
      } catch {
        // Described lazily or not at all: the call below still happens.
      }
      Reflect.apply(originalOpen, this, args);
    };
    const send = function (this: XMLHttpRequest, ...args: unknown[]): void {
      const request = active ? requests.get(this) : undefined;
      if (request) {
        try {
          const xhr = this;
          xhr.addEventListener("load", () => {
            if (xhr.status >= 400) network(request.method, request.url, xhr.status);
          });
          xhr.addEventListener("error", () => network(request.method, request.url, 0));
          xhr.addEventListener("timeout", () => network(request.method, request.url, 0, "timeout"));
        } catch {
          // No listener: nothing reported for this request.
        }
      }
      Reflect.apply(originalSend, this, args);
    };
    proto.open = open as typeof proto.open;
    proto.send = send as typeof proto.send;
    undo.push(() => {
      if (proto.open === (open as typeof proto.open)) proto.open = originalOpen;
      if (proto.send === (send as typeof proto.send)) proto.send = originalSend;
    });
  };

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      active = true;
      reports = 0;
      lastReported.clear();
      for (const install of [() => wrapConsole("error"), () => wrapConsole("warn"), wrapFetch, wrapXhr]) {
        try {
          install();
        } catch {
          // A frozen console or fetch: that part is simply not captured.
        }
      }
      win.addEventListener("error", onError);
      win.addEventListener("unhandledrejection", onRejection);
      undo.push(() => {
        win.removeEventListener("error", onError);
        win.removeEventListener("unhandledrejection", onRejection);
      });
    },
    connect() {
      connected = true;
      const kept = pending;
      pending = [];
      for (const json of kept) dispatch(json);
    },
    stop() {
      active = false;
      connected = false;
      pending = [];
      for (const restore of undo.splice(0).reverse()) {
        try {
          restore();
        } catch {
          // Left in place, inert: every wrapper checks `active`.
        }
      }
    },
  };
}
