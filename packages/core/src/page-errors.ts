import { formatClock } from "./describe";
import { codeSpan, oneLine, truncate } from "./markdown";
import { projectRelativePath } from "./paths";
import {
  ERROR_MESSAGE_MAX_CHARS,
  ERROR_STACK_MAX,
  ERROR_WINDOW_AFTER_MS,
  ERROR_WINDOW_BEFORE_MS,
  EVENT_ERRORS_MAX,
  SESSION_ERRORS_MAX,
  type CapturedError,
  type CapturedErrorDraft,
  type CapturedErrorKind,
  type CapturedEvent,
  type CapturedRequest,
  type Ms,
} from "./schema";

/**
 * Debug capture (D13): the page errors that happened around a gesture. Shared by the extension
 * (which bounds what it stores and picks each gesture's errors at Stop) and the renderers and the
 * CLI (which read them back), so every reader agrees on the caps and the wording.
 *
 * Everything here treats an error as page content: untrusted, bounded, one line.
 */

const KINDS: readonly CapturedErrorKind[] = ["error", "rejection", "console-error", "console-warn", "network"];
/** A source location or a stack frame, like a message, is one bounded line. */
const LOCATION_MAX_CHARS = 300;
/** Other errors listed in the appendix, beyond those shown under an element. */
const OTHER_ERRORS_MAX = 5;

function boundedLine(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = oneLine(value.replace(/[\u0000-\u001f\u007f]/g, " "));
  return line === "" ? undefined : truncate(line, max);
}

/**
 * "src/OrdersTable.tsx:31:7", made project-relative (D8 note 2026-09-27): a stack trace from a
 * file:// page or a source-mapped dev tool can name the machine's absolute path.
 */
function safeLocation(value: unknown): string | undefined {
  const location = boundedLine(value, LOCATION_MAX_CHARS);
  return location === undefined ? undefined : truncate(projectRelativePath(location), LOCATION_MAX_CHARS);
}

/** "OrdersTable (C:/Users/me/app/src/OrdersTable.tsx:31:7)" → "OrdersTable (src/OrdersTable.tsx:31:7)". */
function safeFrame(value: unknown): string | undefined {
  const frame = boundedLine(value, LOCATION_MAX_CHARS);
  if (frame === undefined) return undefined;
  const named = /^(.*?) \((.*)\)$/.exec(frame);
  return named ? `${named[1]} (${safeLocation(named[2]) ?? ""})` : safeLocation(frame);
}

function parseRequest(value: unknown): CapturedRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const method = typeof raw.method === "string" ? raw.method.toUpperCase() : "";
  const url = boundedLine(raw.url, LOCATION_MAX_CHARS);
  const status = raw.status;
  if (!/^[A-Z]{1,16}$/.test(method) || url === undefined) return undefined;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 999) return undefined;
  return { method, url, status };
}

type ErrorFields = Omit<CapturedError, "t" | "count">;

/** The fields every error has, typed and bounded; undefined when the kind or the message is missing. */
function parseFields(raw: Record<string, unknown>): ErrorFields | undefined {
  const kind = KINDS.find((k) => k === raw.kind);
  const message = boundedLine(raw.message, ERROR_MESSAGE_MAX_CHARS);
  if (kind === undefined || message === undefined) return undefined;
  const fields: ErrorFields = { kind, message };
  const source = safeLocation(raw.source);
  if (source !== undefined) fields.source = source;
  if (Array.isArray(raw.stack)) {
    const stack = raw.stack.slice(0, ERROR_STACK_MAX).flatMap((frame) => safeFrame(frame) ?? []);
    if (stack.length > 0) fields.stack = stack;
  }
  if (kind === "network") {
    const request = parseRequest(raw.request);
    if (request !== undefined) fields.request = request;
  }
  return fields;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * A draft from a content script (CapturedErrorDraft), checked and bounded: the content script
 * builds it from what the page's own world reported, which a page script can forge. Undefined
 * when it is malformed.
 */
export function parseCapturedErrorDraft(value: unknown): CapturedErrorDraft | undefined {
  const raw = asRecord(value);
  if (raw === undefined || typeof raw.at !== "number" || !Number.isFinite(raw.at)) return undefined;
  const fields = parseFields(raw);
  return fields === undefined ? undefined : { ...fields, at: raw.at };
}

/**
 * `SessionFile.errors` or `CapturedEvent.errors` as read from a file, bounded like at capture.
 * Lenient: a malformed entry is dropped, never the session (a hand-edited file still renders).
 * Undefined when nothing valid is left.
 */
export function parseCapturedErrors(value: unknown, max = SESSION_ERRORS_MAX): CapturedError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const errors: CapturedError[] = [];
  for (const item of value.slice(-max)) {
    const raw = asRecord(item);
    if (raw === undefined || typeof raw.t !== "number" || !Number.isFinite(raw.t)) continue;
    const fields = parseFields(raw);
    if (fields === undefined) continue;
    const error: CapturedError = { ...fields, t: Math.max(0, Math.round(raw.t)) };
    if (typeof raw.count === "number" && Number.isInteger(raw.count) && raw.count > 1) error.count = raw.count;
    errors.push(error);
  }
  return errors.length > 0 ? errors : undefined;
}

/** Two errors are the same when they say the same thing from the same place. */
function errorKey(error: CapturedError): string {
  const request = error.request;
  const what = request ? `${request.method} ${request.url} ${request.status}` : error.message;
  return `${error.kind}\u0000${what}\u0000${error.source ?? ""}`;
}

/** Exceptions and failed requests first, then console.error, then console.warn. */
function severity(error: CapturedError): number {
  return error.kind === "console-warn" ? 2 : error.kind === "console-error" ? 1 : 0;
}

/** Identical errors merged into the first one, with the repeats in `count`. */
function merged(errors: readonly CapturedError[]): CapturedError[] {
  const byKey = new Map<string, CapturedError>();
  for (const error of [...errors].sort((a, b) => a.t - b.t)) {
    const key = errorKey(error);
    const first = byKey.get(key);
    if (first === undefined) byKey.set(key, { ...error });
    else first.count = (first.count ?? 1) + (error.count ?? 1);
  }
  return [...byKey.values()];
}

/**
 * The errors of a gesture (CapturedEvent.errors): those from ERROR_WINDOW_BEFORE_MS before it
 * started to ERROR_WINDOW_AFTER_MS after it ended, identical ones merged, at most `max`. When there
 * are more, the most severe win, then the closest to the gesture. In time order.
 */
export function errorsAround(
  event: Pick<CapturedEvent, "tStart" | "tEnd">,
  errors: readonly CapturedError[],
  max = EVENT_ERRORS_MAX,
): CapturedError[] {
  const from = event.tStart - ERROR_WINDOW_BEFORE_MS;
  const to = event.tEnd + ERROR_WINDOW_AFTER_MS;
  const distance = (error: CapturedError) =>
    error.t < event.tStart ? event.tStart - error.t : Math.max(0, error.t - event.tEnd);
  return merged(errors.filter((error) => error.t >= from && error.t <= to))
    .sort((a, b) => severity(a) - severity(b) || distance(a) - distance(b) || a.t - b.t)
    .slice(0, max)
    .sort((a, b) => a.t - b.t);
}

/** Each event with its errors (errorsAround), and the session's list capped at SESSION_ERRORS_MAX. */
export function attachErrors(
  events: readonly CapturedEvent[],
  errors: readonly CapturedError[],
): { events: CapturedEvent[]; errors?: CapturedError[] } {
  if (errors.length === 0) return { events: [...events] };
  const withErrors = events.map((event) => {
    const around = errorsAround(event, errors);
    return around.length > 0 ? { ...event, errors: around } : event;
  });
  const recent = [...errors].sort((a, b) => a.t - b.t).slice(-SESSION_ERRORS_MAX);
  return { events: withErrors, errors: recent };
}

const LABELS: Readonly<Record<CapturedErrorKind, string>> = {
  error: "uncaught",
  rejection: "unhandled rejection",
  "console-error": "console.error",
  "console-warn": "console.warn",
  network: "network",
};

/** "src/OrdersTable.tsx:31:7" → "src/OrdersTable.tsx:31": the column adds nothing for the agent. */
function withoutColumn(location: string): string {
  return location.replace(/(:\d+):\d+$/, "$1");
}

function seconds(ms: Ms): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** When the error happened, next to a gesture: "1.2 s before", "0.4 s after", "while pointing". */
function timing(error: CapturedError, event: Pick<CapturedEvent, "tStart" | "tEnd">): string {
  if (error.t < event.tStart) return `${seconds(event.tStart - error.t)} before`;
  if (error.t > event.tEnd) return `${seconds(error.t - event.tEnd)} after`;
  return "while pointing";
}

/**
 * One error in one Markdown line, page text in code spans so it reads as data, never as
 * formatting or an instruction:
 *   network: `POST /api/export` → 500 (1.2 s before)
 *   uncaught: `TypeError: x is undefined` at `src/OrdersTable.tsx:31` ×3 (0.4 s before)
 * `when` is the timing in parentheses.
 */
export function errorLine(error: CapturedError, when: string): string {
  const request = error.request;
  const what = request
    ? `${codeSpan(`${request.method} ${request.url}`)} → ${request.status === 0 ? "failed" : request.status}`
    : codeSpan(truncate(oneLine(error.message), ERROR_MESSAGE_MAX_CHARS));
  const where = !request && error.source ? ` at ${codeSpan(withoutColumn(error.source))}` : "";
  const count = error.count !== undefined && error.count > 1 ? ` ×${error.count}` : "";
  return `${LABELS[error.kind]}: ${what}${where}${count} (${when})`;
}

/**
 * The lines under a gesture, without list markers: "errors around this moment:" and one line per
 * error. Empty when there were none, so a session without errors renders as before.
 */
export function eventErrorLines(event: CapturedEvent): string[] {
  const errors = parseCapturedErrors(event.errors, EVENT_ERRORS_MAX) ?? [];
  return errors.map((error) => errorLine(error, timing(error, event)));
}

/**
 * The errors of a whole element entry (several gestures at the same element), merged and capped
 * like one gesture's, each timed against the gesture it was captured with.
 */
export function groupErrorLines(events: readonly CapturedEvent[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const event of events) {
    for (const error of parseCapturedErrors(event.errors, EVENT_ERRORS_MAX) ?? []) {
      const key = errorKey(error);
      if (seen.has(key) || lines.length >= EVENT_ERRORS_MAX) continue;
      seen.add(key);
      lines.push(errorLine(error, timing(error, event)));
    }
  }
  return lines;
}

/**
 * The session's errors that were near no gesture (SessionFile.errors outside every event's
 * window), merged, at most OTHER_ERRORS_MAX, as "- …" lines with their time in the recording,
 * plus a line saying how many more are in session.json. Empty when there are none.
 */
export function otherErrorLines(sessionErrors: unknown, events: readonly CapturedEvent[]): string[] {
  const errors = parseCapturedErrors(sessionErrors) ?? [];
  const near = (error: CapturedError) =>
    events.some((event) => error.t >= event.tStart - ERROR_WINDOW_BEFORE_MS && error.t <= event.tEnd + ERROR_WINDOW_AFTER_MS);
  const others = merged(errors.filter((error) => !near(error)));
  if (others.length === 0) return [];
  const shown = [...others]
    .sort((a, b) => severity(a) - severity(b) || a.t - b.t)
    .slice(0, OTHER_ERRORS_MAX)
    .sort((a, b) => a.t - b.t);
  const lines = shown.map((error) => `- ${errorLine(error, `at ${formatClock(error.t)}`)}`);
  const more = others.length - shown.length;
  if (more > 0) lines.push(`- …and ${more} more in session.json`);
  return lines;
}

/** The heading of the appendix block otherErrorLines fills. */
export const OTHER_ERRORS_HEADING = "Errors during the recording, not near any pointed element:";
/** The line that introduces a gesture's errors. */
export const EVENT_ERRORS_HEADING = "errors around this moment:";
