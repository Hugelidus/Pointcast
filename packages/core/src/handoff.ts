/**
 * Handoff protocol v1 between the extension and a running pointcast MCP server (decisions.md D11).
 * The extension sends, the CLI receives; both import these names, limits and answer shapes from
 * here so the two sides cannot drift apart. Pure: core has no Node or DOM types, so no URL class.
 */

import { truncate } from "./markdown";

export const HANDOFF_PROTOCOL = 1;
/** 0x5043, "PC". The e2e build uses 5542 instead (.env.e2e). */
export const HANDOFF_PORT = 20547;
export const HANDOFF_HOST = "127.0.0.1";
export const HANDOFF_HELLO_PATH = "/pointcast/v1/hello";
/** Followed by the session id. */
export const HANDOFF_SESSIONS_PATH = "/pointcast/v1/sessions/";
export const HANDOFF_HEADER = "X-Pointcast-Handoff";
export const HANDOFF_HEADER_VALUE = "1";
export const HANDOFF_FILES_HEADER = "X-Pointcast-Files";
export const HANDOFF_CONTENT_TYPE = "application/octet-stream";

/** Protocol order: session.json first, so a reader of the header sees the required file first. */
export const HANDOFF_FILE_NAMES = ["session.json", "words.json", "session.md", "audio.wav", "audio.webm"] as const;
export type HandoffFileName = (typeof HANDOFF_FILE_NAMES)[number];
export const HANDOFF_MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024; // session.json, words.json, session.md
export const HANDOFF_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Audio is bounded by the total only: a long WAV kept on request can pass 32 MiB. */
const TEXT_FILE_NAMES: ReadonlySet<string> = new Set<HandoffFileName>(["session.json", "words.json", "session.md"]);

/**
 * "YYYY-MM-DD_HH-mm-ss" or "…-N" (extension session-id.ts). The 7 capture groups are used by the
 * CLI's discover.ts, which imports this pattern instead of its own copy.
 */
export const SESSION_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?$/;

/**
 * The id becomes a folder name on the receiver and a URL path segment on the sender, so this
 * pattern is also the path-traversal guard: "..", "latest", ".incoming-…" and "%2e%2e" never pass.
 */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

/** `http://127.0.0.1:${port}${path}`. */
export function handoffUrl(port: number, path: string): string {
  return `http://${HANDOFF_HOST}:${port}${path}`;
}

/** HANDOFF_SESSIONS_PATH + id. Throws on an id that fails isSessionId. */
export function sessionPath(sessionId: string): string {
  if (!isSessionId(sessionId)) throw new Error(`Not a pointcast session id: ${JSON.stringify(sessionId)}`);
  return HANDOFF_SESSIONS_PATH + sessionId;
}

export interface HandoffFile {
  name: HandoffFileName;
  size: number;
}

/** Position in HANDOFF_FILE_NAMES, -1 for any other name. */
function fileRank(name: string): number {
  return (HANDOFF_FILE_NAMES as readonly string[]).indexOf(name);
}

/**
 * Why this set of names cannot be sent, or undefined when it can. Rules: every name in
 * HANDOFF_FILE_NAMES, in its order, no repeats, session.json present, not both audio files.
 */
export function fileSetError(names: readonly string[]): string | undefined {
  let previousRank = -1;
  for (const [index, name] of names.entries()) {
    const rank = fileRank(name);
    if (rank < 0) return `unexpected file ${JSON.stringify(name)}`;
    if (names.indexOf(name) !== index) return `${name} is listed twice`;
    if (rank < previousRank) return `${name} is out of order (expected ${HANDOFF_FILE_NAMES.join(", ")})`;
    previousRank = rank;
  }
  if (!names.includes("session.json")) return "session.json is missing";
  if (names.includes("audio.wav") && names.includes("audio.webm")) return "audio.wav and audio.webm cannot both be sent";
  return undefined;
}

/** The files sorted into protocol order; undefined when fileSetError finds a problem. For the extension. */
export function orderForHandoff<T extends { fileName: string }>(files: readonly T[]): T[] | undefined {
  const ordered = [...files].sort((a, b) => fileRank(a.fileName) - fileRank(b.fileName));
  return fileSetError(ordered.map((file) => file.fileName)) === undefined ? ordered : undefined;
}

/** "session.json=18231,words.json=5120". No spaces. */
export function formatFilesHeader(files: readonly HandoffFile[]): string {
  return files.map((file) => `${file.name}=${file.size}`).join(",");
}

export type ParsedFilesHeader =
  | { ok: true; files: HandoffFile[]; totalBytes: number }
  | { ok: false; error: "bad-request" | "too-large"; message: string };

/** The longest valid value is under 100 characters; the cap bounds the work a hostile header costs. */
const MAX_FILES_HEADER_LENGTH = 512;
/** "name=size". No leading zeros and at most 10 digits, so Number() is exact and "01" or "1e3" never pass. */
const FILES_HEADER_ENTRY = /^([^=]*)=(0|[1-9]\d{0,9})$/;
const MIB = 1024 * 1024;

/**
 * Strict: value ≤ 512 chars; entries split on ","; each `name=size` with size /^(0|[1-9]\d{0,9})$/;
 * fileSetError must pass; "too-large" when a text file > HANDOFF_MAX_TEXT_FILE_BYTES or the
 * total > HANDOFF_MAX_TOTAL_BYTES. undefined or "" → bad-request.
 */
export function parseFilesHeader(value: string | undefined): ParsedFilesHeader {
  const badRequest = (message: string): ParsedFilesHeader => ({ ok: false, error: "bad-request", message });
  const tooLarge = (message: string): ParsedFilesHeader => ({ ok: false, error: "too-large", message });

  if (value === undefined || value === "") return badRequest(`missing ${HANDOFF_FILES_HEADER} header`);
  if (value.length > MAX_FILES_HEADER_LENGTH) {
    return badRequest(`${HANDOFF_FILES_HEADER} header is longer than ${MAX_FILES_HEADER_LENGTH} characters`);
  }

  const entries: { name: string; size: number }[] = [];
  for (const entry of value.split(",")) {
    const match = FILES_HEADER_ENTRY.exec(entry);
    if (match === null) {
      return badRequest(`bad ${HANDOFF_FILES_HEADER} entry ${JSON.stringify(entry)} (expected name=bytes)`);
    }
    entries.push({ name: match[1]!, size: Number(match[2]) });
  }
  const setError = fileSetError(entries.map((entry) => entry.name));
  if (setError !== undefined) return badRequest(`${HANDOFF_FILES_HEADER}: ${setError}`);
  // fileSetError accepted every name.
  const files = entries as HandoffFile[];

  for (const file of files) {
    if (TEXT_FILE_NAMES.has(file.name) && file.size > HANDOFF_MAX_TEXT_FILE_BYTES) {
      return tooLarge(`${file.name} is larger than ${HANDOFF_MAX_TEXT_FILE_BYTES / MIB} MiB`);
    }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > HANDOFF_MAX_TOTAL_BYTES) {
    return tooLarge(`the recording's files add up to more than ${HANDOFF_MAX_TOTAL_BYTES / MIB} MiB`);
  }
  return { ok: true, files, totalBytes };
}

export type HandoffErrorCode =
  | "unknown-extension"
  | "bad-request"
  | "length-required"
  | "too-large"
  | "exists"
  | "busy"
  | "not-found"
  | "write-failed";

/** HTTP status of each error: 403, 400, 411, 413, 409, 503, 404, 500. */
export const HANDOFF_ERROR_STATUS: Readonly<Record<HandoffErrorCode, number>> = {
  "unknown-extension": 403,
  "bad-request": 400,
  "length-required": 411,
  "too-large": 413,
  exists: 409,
  busy: 503,
  "not-found": 404,
  "write-failed": 500,
};

export interface HelloAnswer {
  app: "pointcast";
  protocol: number;
  version: string;
}
export interface StoredAnswer {
  app: "pointcast";
  id: string;
  dir: string;
}
export interface ErrorAnswer {
  app: "pointcast";
  error: HandoffErrorCode;
  message: string;
}

const MAX_VERSION_LENGTH = 64;
const MAX_DIR_LENGTH = 1024;
const MAX_ERROR_MESSAGE_LENGTH = 300;
/** Unicode category Cc: C0 (U+0000–U+001F), DEL and C1 (U+0080–U+009F). */
const CONTROL_CHARACTER = /\p{Cc}/u;
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/**
 * Whatever answers on the port may be another program, so every answer is checked field by
 * field, and the parsers return fresh objects: unknown fields never reach the popup.
 */
function isPointcastAnswer(value: unknown): value is Record<string, unknown> & { app: "pointcast" } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { app?: unknown }).app === "pointcast"
  );
}

function isHandoffErrorCode(value: unknown): value is HandoffErrorCode {
  return typeof value === "string" && Object.hasOwn(HANDOFF_ERROR_STATUS, value);
}

/** app === "pointcast", protocol an integer, version a string ≤ 64 chars; else undefined. The caller checks the protocol. */
export function parseHelloAnswer(value: unknown): HelloAnswer | undefined {
  if (!isPointcastAnswer(value)) return undefined;
  const { protocol, version } = value;
  if (typeof protocol !== "number" || !Number.isInteger(protocol)) return undefined;
  if (typeof version !== "string" || version.length > MAX_VERSION_LENGTH) return undefined;
  return { app: "pointcast", protocol, version };
}

/** app === "pointcast", id === sessionId, dir a string of 1–1024 chars with no control characters; else undefined. */
export function parseStoredAnswer(value: unknown, sessionId: string): StoredAnswer | undefined {
  if (!isPointcastAnswer(value) || value.id !== sessionId) return undefined;
  const { dir } = value;
  if (typeof dir !== "string" || dir.length < 1 || dir.length > MAX_DIR_LENGTH || CONTROL_CHARACTER.test(dir)) {
    return undefined;
  }
  return { app: "pointcast", id: sessionId, dir };
}

/** app === "pointcast" and a known error code; message passed through cleanDisplayText(…, 300). */
export function parseErrorAnswer(value: unknown): ErrorAnswer | undefined {
  if (!isPointcastAnswer(value)) return undefined;
  const { error, message } = value;
  if (!isHandoffErrorCode(error) || typeof message !== "string") return undefined;
  return { app: "pointcast", error, message: cleanDisplayText(message, MAX_ERROR_MESSAGE_LENGTH) };
}

/** Removes C0/C1 control characters and truncates to maxLength with "…". */
export function cleanDisplayText(value: string, maxLength: number): string {
  return truncate(value.replace(CONTROL_CHARACTERS, ""), maxLength);
}

/**
 * Public key (base64 SPKI DER) of the Chrome Web Store item. Every build except the store uploads
 * carries it as the manifest `key`, so the release zip, `pnpm build` and the e2e build all get the
 * store item's id, which a receiver accepts. Nothing is signed with it: Chrome only derives the id.
 * Copied from the developer dashboard (Package > Public key).
 */
export const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq9PXy4ImX/n4hHfuKZivGUibMS7hgFv9iMvwyavUmju9ZtiUAt8Sb89NA3mwYlAVuqPP+Nn+AnMeQp7HmriBguYdR+XnqrILAGM9oQ74nGsJfCuR6At4yguXRBgaL7JkZufIHrPBAufKUIc2rWNDLQ5QiLAB3ZAWzLLjvv28DB6EErmmNR3m3bybsGBnWMGhbxv7G7WpPGgz2dlPfULS2f17LpEE/dvRmyMjTjmYlp8FYWq6MkDXrRYa7Awn4lt6C4vFlJO6wDl3aBd78/tid9jaGQ2J8HHgTxybqjOQmACdsyHc2dINCseFLMUMKa3cFdatuKDM9kasY8ocVUNM6wIDAQAB";
/** Chrome's id for that key (the store item's id): SHA-256 of the DER, first 32 hex digits mapped 0-f → a-p. Checked by a CLI test. */
export const EXTENSION_ID = "hliijcklkpbddgjhkifjeggidghbbboa";
/**
 * Builds a receiver accepts out of the box: the Chrome Web Store item and every build carrying its
 * key. The Edge Add-ons id is appended once it is known; until then, and for forks,
 * POINTCAST_EXTENSION_IDS adds more.
 */
export const OFFICIAL_EXTENSION_IDS: readonly string[] = [EXTENSION_ID];
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** `chrome-extension://${id}`. */
export function extensionOrigin(id: string): string {
  return `chrome-extension://${id}`;
}
