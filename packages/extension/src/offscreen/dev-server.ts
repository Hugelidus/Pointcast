import { cachingReader, projectMatch, resolveSession, type CapturedEvent, type SessionFile, type SourceReader } from "@pointcast/core";

/**
 * Route 3 of the code pointer (D9 note 2026-09-27, "resolve from the dev server"): at Stop, the
 * elements' chains (`renderedBy`) are resolved against the source the page's own dev server
 * serves, so the copied spec gets its `text at:` lines with nothing installed. Core's resolver
 * does the work; this file only reads files.
 *
 * Vite serves any file inside its root as a module that exports the file's text:
 * GET <origin>/src/lib/More.svelte?raw -> `export default "<contents as a JSON string>"`.
 * Other dev servers (webpack, Next.js) have no such endpoint, and guessing their source maps is
 * not worth it: they get "not available" and the spec stays as it was.
 *
 * Privacy: the source text stays in memory for the few ms the resolver needs it; only paths, line
 * numbers and the one source line of each location (a snippet, never for sensitive elements)
 * reach the spec. Nothing is logged, saved or sent anywhere else.
 */

/** Stop -> clipboard stays fast: every dev server read of one session shares this budget. */
export const DEV_SERVER_BUDGET_MS = 2_000;

/**
 * renderedBy paths are project-relative, but the project may be a monorepo whose Vite root is a
 * package: "apps/web/src/App.svelte" is served as "/src/App.svelte". A read may drop up to this
 * many leading segments.
 */
const MAX_DROPPED_SEGMENTS = 2;

/** A session rarely spans more than one app; past this many origins, the rest are not read. */
const MAX_ORIGINS = 3;

export interface DevServerDeps {
  fetch: typeof fetch;
  /** Defaults to DEV_SERVER_BUDGET_MS. */
  budgetMs?: number;
}

export interface CodeResolution {
  /** The session with `resolved` set where the dev server's source gave an unambiguous location. */
  session: SessionFile;
  /** One line for the popup's details; absent when no element has a chain (nothing was tried). */
  note?: string;
}

/** Why a read did not give usable source. */
type ReadFailure = "timeout" | "unreachable";

type OriginOutcome =
  | { kind: "resolved"; session: SessionFile; found: number }
  | { kind: "not-vite" | "not-found" | ReadFailure };

/**
 * Resolves every element with a chain against its page's dev server, within the budget. Never
 * throws and never makes the spec worse: an origin that times out, fails or is not Vite leaves
 * its events exactly as captured.
 */
export async function resolveFromDevServer(session: SessionFile, deps: DevServerDeps): Promise<CodeResolution> {
  const origins = [...new Set(session.events.filter(hasChain).flatMap((event) => originOf(event.url) ?? []))];
  if (origins.length === 0) return { session };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.budgetMs ?? DEV_SERVER_BUDGET_MS);
  try {
    const outcomes = await Promise.all(
      origins.slice(0, MAX_ORIGINS).map(async (origin) => {
        const events = session.events.filter((event) => originOf(event.url) === origin);
        return resolveOrigin({ ...session, events }, origin, deps.fetch, controller.signal);
      }),
    );
    const resolved = new Map<string, CapturedEvent>();
    for (const outcome of outcomes) {
      if (outcome.kind === "resolved") for (const event of outcome.session.events) resolved.set(event.id, event);
    }
    const events = session.events.map((event) => resolved.get(event.id) ?? event);
    return { session: { ...session, events }, note: noteFor(outcomes) };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOrigin(session: SessionFile, origin: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<OriginOutcome> {
  try {
    if (!(await isViteDevServer(origin, fetchFn, signal))) return { kind: "not-vite" };
  } catch {
    return { kind: signal.aborted ? "timeout" : "unreachable" };
  }
  const reader = devServerReader(origin, fetchFn, signal);
  const cached = cachingReader(reader);
  const match = await projectMatch(session, cached);
  const resolved = match.matches ? await resolveSession(session, cached, "dev-server") : session;
  // A file missing because a read timed out or failed is not a file that is not there: the
  // resolver could call a literal unique that the unread file also has. Silence instead.
  const failure = reader.failure();
  if (failure) return { kind: failure };
  if (!match.matches) return { kind: "not-found" };
  const found = resolved.events.reduce((sum, event) => sum + (event.element.resolved?.length ?? 0), 0);
  return { kind: "resolved", session: resolved, found };
}

type Unavailable = Exclude<OriginOutcome["kind"], "resolved">;

const UNAVAILABLE: Record<Unavailable, string> = {
  "not-vite": "not a Vite dev server",
  "not-found": "it did not serve the files the page names",
  timeout: "no answer in time",
  unreachable: "could not reach it",
};

/** One line for the popup; when nothing was read, the reason of the first origin. */
function noteFor(outcomes: readonly OriginOutcome[]): string {
  let found = 0;
  let read = false;
  let failed: Unavailable | undefined;
  for (const outcome of outcomes) {
    if (outcome.kind === "resolved") {
      found += outcome.found;
      read = true;
    } else {
      failed ??= outcome.kind;
    }
  }
  if (found > 0) return `Code pointer: ${found} location${found === 1 ? "" : "s"} found in the source the dev server serves.`;
  if (read || failed === undefined) return "Code pointer: source read from the dev server; no unambiguous text location.";
  return `Code pointer: dev server source not available (${UNAVAILABLE[failed]}).`;
}

/** A reader that also says whether any read failed (timeout, network error) rather than 404. */
export interface DevServerReader extends SourceReader {
  failure(): ReadFailure | undefined;
}

/**
 * Reads project-relative files from a Vite dev server. Until one file has been found, a path is
 * tried as it is, then without its first segment, then without its first two (monorepo
 * prefixes). Once one worked, every later path uses that prefix only: the resolver's import
 * probes (".ts", ".js", "/index.ts"…) then cost one request each, not three.
 */
export function devServerReader(origin: string, fetchFn: typeof fetch, signal: AbortSignal): DevServerReader {
  let knownDrop: number | undefined;
  let failure: ReadFailure | undefined;
  return {
    failure: () => failure,
    async read(path) {
      const segments = path.split("/");
      const maxDrop = Math.min(MAX_DROPPED_SEGMENTS, segments.length - 1);
      const drops = knownDrop !== undefined ? [knownDrop] : Array.from({ length: maxDrop + 1 }, (_, i) => i);
      for (const drop of drops) {
        if (drop > maxDrop) continue;
        // Outside the try: a path that cannot be encoded is unreadable, not a failed server.
        const url = `${origin}/${encodePath(segments.slice(drop).join("/"))}?raw`;
        let source: string | undefined;
        try {
          source = await fetchRaw(url, fetchFn, signal);
        } catch (error) {
          failure ??= signal.aborted ? "timeout" : "unreachable";
          throw error;
        }
        if (source !== undefined) {
          knownDrop ??= drop;
          return source;
        }
      }
      return undefined;
    },
  };
}

/** The file's text, or undefined when the server has no such file (404, or not a raw module). */
async function fetchRaw(url: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetchFn(url, { signal, cache: "no-store" });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const body = await response.text();
  const raw = parseRawModule(body);
  if (raw !== undefined) return raw;
  // Vite leaves .json to its static server, which ignores ?raw and sends the file itself.
  return /\.json\?raw$/i.test(url) && /json/i.test(response.headers.get("content-type") ?? "") ? body : undefined;
}

/**
 * The string of Vite's `export default "<JSON string>"` module, undefined for anything else (an
 * SPA fallback's index.html, a transformed module). JSON.stringify writes no raw line break, so
 * the literal ends on the first line; Vite may add `;` or a source map comment after it.
 */
export function parseRawModule(body: string): string | undefined {
  const prefix = "export default ";
  const start = body.indexOf(prefix);
  if (start < 0 || body.slice(0, start).trim() !== "") return undefined;
  const firstLine = body.slice(start + prefix.length).split("\n", 1)[0] ?? "";
  try {
    const value: unknown = JSON.parse(firstLine.replace(/;?\s*$/, ""));
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Vite's own client is served by every Vite dev server (SvelteKit's too) at this fixed path. A
 * server with an SPA fallback answers any path with index.html, so the type is checked as well.
 */
async function isViteDevServer(origin: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<boolean> {
  const response = await fetchFn(`${origin}/@vite/client`, { signal, cache: "no-store" });
  void response.body?.cancel().catch(() => undefined);
  return response.ok && /javascript/i.test(response.headers.get("content-type") ?? "");
}

/**
 * Vite decodes the URL with decodeURI, which leaves "%2B" encoded: SvelteKit's "+page.svelte"
 * must go as it is. So only what would break the URL is escaped.
 */
function encodePath(path: string): string {
  return encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

function hasChain(event: CapturedEvent): boolean {
  return Array.isArray(event.element.renderedBy) && event.element.renderedBy.length > 0;
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}
