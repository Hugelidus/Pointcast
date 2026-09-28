import {
  HANDOFF_CONTENT_TYPE,
  HANDOFF_FILES_HEADER,
  HANDOFF_HEADER,
  HANDOFF_HEADER_VALUE,
  HANDOFF_HELLO_PATH,
  HANDOFF_PROTOCOL,
  formatFilesHeader,
  handoffUrl,
  isSessionId,
  orderForHandoff,
  parseErrorAnswer,
  parseHelloAnswer,
  parseStoredAnswer,
  sessionPath,
  type HandoffFileName,
} from "@pointcast/core";
import type { ProcessingOptions, ProcessingResult } from "../messages";
import type { ProcessedSession, SessionFileBlob } from "./session-processor";

/**
 * Handoff to a running pointcast MCP server (D11, protocol in core's handoff.ts): after the
 * Markdown is on the clipboard, the offscreen document asks 127.0.0.1 whether a pointcast MCP
 * server listens there and, if one does, posts it the session's files in one request. It stores
 * them in the sessions folder its tools read, so Chrome downloads nothing and no Save dialog can
 * appear. Anything else (nobody there, another program, a refusal, a failure) leaves the files to
 * chrome.downloads as before: the Blobs stay here until one of the two paths saved them.
 */

/** A refused connect takes milliseconds; this only bounds a program that accepts and never answers. */
export const HANDOFF_HELLO_TIMEOUT_MS = 1_500;
/**
 * 256 MiB over loopback takes a few seconds. Hello + upload stay under the processing alarm's
 * grace (commands.ts ALARM_GRACE_MS), so the alarm never closes this document mid-upload.
 */
export const HANDOFF_UPLOAD_TIMEOUT_MS = 30_000;

/** An answer longer than this is not from pointcast: its answers are a few hundred bytes. */
const MAX_ANSWER_BYTES = 4 * 1024;

export interface HandoffDeps {
  fetch: typeof fetch;
  port: number;
  /** This extension's id, named in the warning when the server does not accept it. */
  extensionId: string;
  /** Defaults to HANDOFF_HELLO_TIMEOUT_MS. */
  helloTimeoutMs?: number;
  /** Defaults to HANDOFF_UPLOAD_TIMEOUT_MS. */
  uploadTimeoutMs?: number;
}

export type HandoffOutcome =
  | { kind: "handed-off"; dir: string }
  /** Nobody listens, or a program that is not pointcast: downloads, silently. */
  | { kind: "no-receiver" }
  /** A pointcast MCP server is there but did not store the recording: downloads, and the popup says why. */
  | { kind: "refused"; warning: string };

const NO_RECEIVER: HandoffOutcome = { kind: "no-receiver" };

/**
 * Both requests. Never set a referrer policy: "no-referrer" makes Chrome send `Origin: null`, and
 * the receiver only accepts this extension's origin. No cookies, no redirect to anywhere else.
 */
const REQUEST: RequestInit = { method: "POST", credentials: "omit", redirect: "error", cache: "no-store" };

/**
 * Agents run the server version their plugin or MCP config pins (`pointcast@0.2`), so updating
 * means updating that, not running `npx pointcast@latest` once (D11, pinned plugin versions).
 */
const ANOTHER_VERSION =
  "The pointcast MCP server on this computer speaks another version of the handoff: update your agent's " +
  "pointcast plugin or extension (or the pointcast@ version in its MCP config) and this extension. " +
  "Chrome's downloads saved this recording instead.";

function refused(warning: string): HandoffOutcome {
  return { kind: "refused", warning };
}

function notTaken(reason: string): HandoffOutcome {
  return refused(`The pointcast MCP server did not take this recording (${reason}), so Chrome's downloads saved it instead.`);
}

/**
 * Offers the session's files to a pointcast MCP server on `deps.port`: a hello first, so no other
 * program ever receives the recording and a server that would refuse it is known before the
 * upload. Never throws.
 */
export async function handOff(sessionId: string, files: readonly SessionFileBlob[], deps: HandoffDeps): Promise<HandoffOutcome> {
  const ordered = orderForHandoff(files);
  if (!ordered || !isSessionId(sessionId)) {
    // processSession and the service worker never produce these: a bug, but the recording is safe.
    const what = ordered ? `session id "${sessionId}"` : `files ${files.map((file) => file.fileName).join(", ")}`;
    return refused(
      `The recording was not sent to a pointcast MCP server (internal error: unexpected ${what}), ` +
        "so Chrome's downloads saved it instead.",
    );
  }

  const hello = await sayHello(deps);
  if (hello.kind !== "ready") return hello;

  const signal = AbortSignal.timeout(deps.uploadTimeoutMs ?? HANDOFF_UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(handoffUrl(deps.port, sessionPath(sessionId)), {
      ...REQUEST,
      headers: {
        [HANDOFF_HEADER]: HANDOFF_HEADER_VALUE,
        // orderForHandoff accepted every name.
        [HANDOFF_FILES_HEADER]: formatFilesHeader(
          ordered.map((file) => ({ name: file.fileName as HandoffFileName, size: file.blob.size })),
        ),
        "Content-Type": HANDOFF_CONTENT_TYPE,
      },
      // The files' bytes back to back, in the header's order; a Blob of Blobs copies nothing.
      body: new Blob(ordered.map((file) => file.blob)),
      signal,
    });
  } catch {
    return notTaken(signal.aborted ? "it did not answer in time" : "the connection failed");
  }
  // A v1 server serves every /v1 path it knows: a 404 means it only speaks another version.
  if (response.status === 404) {
    discard(response);
    return refused(ANOTHER_VERSION);
  }
  const answer = await readAnswer(response);
  if (response.status === 201) {
    const stored = parseStoredAnswer(answer, sessionId);
    if (stored) return { kind: "handed-off", dir: stored.dir };
    return notTaken(signal.aborted ? "it did not answer in time" : "it gave an unexpected answer");
  }
  return notTaken(parseErrorAnswer(answer)?.message ?? `HTTP ${response.status}`);
}

/** "ready" when a pointcast MCP server that accepts this extension and speaks this protocol answered. */
async function sayHello(deps: HandoffDeps): Promise<HandoffOutcome | { kind: "ready" }> {
  const signal = AbortSignal.timeout(deps.helloTimeoutMs ?? HANDOFF_HELLO_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(handoffUrl(deps.port, HANDOFF_HELLO_PATH), {
      ...REQUEST,
      headers: { [HANDOFF_HEADER]: HANDOFF_HEADER_VALUE },
      signal,
    });
  } catch {
    // Refused (nothing listens) or no answer in time.
    return NO_RECEIVER;
  }
  if (response.status === 200) {
    const hello = parseHelloAnswer(await readAnswer(response));
    // Some other program on the port: not ours to warn about.
    if (!hello) return NO_RECEIVER;
    return hello.protocol === HANDOFF_PROTOCOL ? { kind: "ready" } : refused(ANOTHER_VERSION);
  }
  if (response.status === 403) {
    if (parseErrorAnswer(await readAnswer(response))?.error === "unknown-extension") {
      return refused(
        `A pointcast MCP server is running but does not accept this build of the extension (id ${deps.extensionId}). ` +
          `Chrome's downloads saved the recording instead. To accept it, set POINTCAST_EXTENSION_IDS=${deps.extensionId} for the server.`,
      );
    }
    return NO_RECEIVER;
  }
  discard(response);
  return NO_RECEIVER;
}

/**
 * The answer's JSON, or undefined when it is not JSON, is longer than MAX_ANSWER_BYTES, or could
 * not be read (the request's timeout also covers the body). Read in chunks, so a program that
 * streams without end costs at most MAX_ANSWER_BYTES.
 */
async function readAnswer(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ANSWER_BYTES) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Frees an answer whose body is not needed. */
function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

export interface PublishDeps {
  handOff(sessionId: string, files: readonly SessionFileBlob[]): Promise<HandoffOutcome>;
  createObjectURL(blob: Blob): string;
}

/**
 * processSession's output → the ProcessingResult reported to the service worker: handed off to a
 * pointcast MCP server (no files to download), or the files as blob: URLs for chrome.downloads,
 * with the reason in the warning when a server refused them.
 */
export async function publishFiles(
  sessionId: string,
  processed: ProcessedSession,
  options: Pick<ProcessingOptions, "handoff">,
  deps: PublishDeps,
): Promise<ProcessingResult> {
  let warning = processed.warning;
  if (options.handoff && processed.files.length > 0) {
    let outcome: HandoffOutcome;
    try {
      outcome = await deps.handOff(sessionId, processed.files);
    } catch (error) {
      // handOff never throws; if a bug made it, the downloads below must still save the recording.
      outcome = notTaken(error instanceof Error ? error.message : String(error));
    }
    if (outcome.kind === "handed-off") return { ...processed, files: [], handedOff: { dir: outcome.dir } };
    if (outcome.kind === "refused") warning = warning ? `${warning} ${outcome.warning}` : outcome.warning;
  }
  return {
    ...processed,
    ...(warning ? { warning } : {}),
    files: processed.files.map(({ fileName, blob }) => ({ fileName, url: deps.createObjectURL(blob) })),
  };
}
