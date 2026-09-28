import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  EXTENSION_ID_PATTERN,
  HANDOFF_CONTENT_TYPE,
  HANDOFF_ERROR_STATUS,
  HANDOFF_FILES_HEADER,
  HANDOFF_HEADER,
  HANDOFF_HEADER_VALUE,
  HANDOFF_HELLO_PATH,
  HANDOFF_HOST,
  HANDOFF_PROTOCOL,
  HANDOFF_SESSIONS_PATH,
  extensionOrigin,
  isSessionId,
  parseFilesHeader,
  type HandoffErrorCode,
} from "@pointcast/core";
import { displayPath, sessionFolderExists, storeSession, sweepStaging } from "./store";

export interface HandoffReceiverOptions {
  /** The sessions folder the MCP tools read (resolveSessionsBase). */
  base: string;
  /** HANDOFF_PORT; 0 in tests. */
  port: number;
  allowedExtensionIds: ReadonlySet<string>;
  /** VERSION, for the hello answer. */
  version: string;
  /** Default: `[pointcast] <message>` on stderr. */
  log?: (message: string) => void;
  /** How often to try the port again while another process holds it. Default 3000. */
  retryMs?: number;
}

export interface HandoffReceiver {
  /** Resolves with the bound port once listening (after retries); never rejects. */
  listening(): Promise<number>;
  /** Stops listening and retrying; an upload already accepted still completes. Idempotent. */
  close(): Promise<void>;
}

/** Every response carries these (protocol v1, §4); never an Access-Control-* header. */
const COMMON_HEADERS = { Connection: "close", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SESSION_URL = /^\/pointcast\/v1\/sessions\/([^/?#]+)$/;
const EXTENSION_ORIGIN_PREFIX = extensionOrigin("");

/**
 * Receives recordings from the extension (D11), inside the `pointcast mcp` process, so they land
 * in the folder its tools read without Chrome's downloads, and so without the Save dialogs that
 * "Ask where to save each file" pops up.
 *
 * - Every instance tries the same port on 127.0.0.1; the first to bind receives, and the others
 *   try again every few seconds, so another takes over soon after the receiver exits (H1). They
 *   all read the same folder, so it does not matter which one receives.
 * - Only the pointcast extension gets through (H4): the exact Host defeats DNS rebinding, pages
 *   cannot forge Origin, and the custom header and content type make a page's request preflighted,
 *   which is refused. Refusals are not logged: a web page could otherwise flood the agent's log.
 * - It runs inside the agent's MCP server, so it never takes the process down or keeps it alive:
 *   errors are answered or logged, the server is unref()'d, and nothing is written to stdout,
 *   which is the MCP channel.
 */
export function startHandoffReceiver(options: HandoffReceiverOptions): HandoffReceiver {
  const log = options.log ?? ((message: string) => console.error(`[pointcast] ${message}`));
  const retryMs = options.retryMs ?? 3_000;
  const allowedOrigins = new Set([...options.allowedExtensionIds].map(extensionOrigin));
  let boundPort: number | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let reportedBusy = false;
  // One upload at a time (H9): a second one is answered 503 and falls back to Chrome's downloads.
  let uploading = false;
  let onListening!: (port: number) => void;
  const listening = new Promise<number>((resolve) => (onListening = resolve));

  // The timeouts bound a client that stalls; the extension's own are 1.5 s (hello) and 30 s (upload).
  const server = createServer({ requestTimeout: 60_000, headersTimeout: 10_000, keepAliveTimeout: 1_000 }, (req, res) => {
    void handle(req, res);
  });
  server.maxConnections = 8;
  // The SDK's stdio transport never ends the process on its own (it ignores stdin's end), so a
  // ref'd listener would keep a dead MCP server alive; runMcpServer also closes this on stdin end.
  server.unref();

  server.on("listening", () => {
    if (closed) {
      server.close();
      return;
    }
    boundPort = (server.address() as AddressInfo).port;
    log(`receiving recordings from the extension on ${HANDOFF_HOST}:${boundPort} (saved in ${displayPath(options.base)})`);
    void sweepStaging(options.base);
    onListening(boundPort);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (closed) return;
    if (boundPort === undefined && (error.code === "EADDRINUSE" || error.code === "EACCES")) {
      if (!reportedBusy) {
        reportedBusy = true;
        log(
          `${HANDOFF_HOST}:${options.port} is in use (another pointcast MCP server receives the recordings, or another program); ` +
            `retrying every ${retryMs / 1000} s`,
        );
      }
      retryTimer = setTimeout(listen, retryMs);
      retryTimer.unref();
      return;
    }
    // The MCP tools work without the receiver: say why recordings will go to Chrome's downloads.
    log(`could not receive recordings from the extension on ${HANDOFF_HOST}:${options.port} (${error.code ?? error.message})`);
  });

  function listen(): void {
    if (!closed) server.listen(options.port, HANDOFF_HOST);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A client that goes away mid-answer is not worth an uncaught 'error' in the agent's MCP server.
    req.on("error", () => {});
    res.on("error", () => {});
    try {
      if (!passesGate(req, res)) return;
      if (req.url === HANDOFF_HELLO_PATH) {
        answer(res, 200, { app: "pointcast", protocol: HANDOFF_PROTOCOL, version: options.version });
      } else if (req.url?.startsWith(HANDOFF_SESSIONS_PATH)) {
        await receiveSession(req, res);
      } else {
        fail(res, "not-found", `no such path in handoff protocol ${HANDOFF_PROTOCOL}`);
      }
    } catch (error) {
      if (res.headersSent) res.destroy();
      else fail(res, "write-failed", `unexpected error: ${(error as Error).message}`);
    }
  }

  /**
   * Checked before routing and before reading any byte of the body (H4, §4). A refusal is an empty
   * 403, which tells a DNS-rebound page (it can read same-origin answers) nothing. The one
   * exception is an extension that is not in the allowlist, so a fork or an Edge build can tell
   * its user what to set.
   */
  function passesGate(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== "POST" || req.headers.host !== `${HANDOFF_HOST}:${boundPort}`) return refuse(res);
    const origin = req.headers.origin ?? "";
    if (!allowedOrigins.has(origin)) {
      const id = origin.startsWith(EXTENSION_ORIGIN_PREFIX) ? origin.slice(EXTENSION_ORIGIN_PREFIX.length) : "";
      if (!EXTENSION_ID_PATTERN.test(id)) return refuse(res);
      fail(
        res,
        "unknown-extension",
        `This pointcast MCP server does not accept extension ${id}. Set POINTCAST_EXTENSION_IDS=${id} for it.`,
      );
      return false;
    }
    if (req.headers[HANDOFF_HEADER.toLowerCase()] !== HANDOFF_HEADER_VALUE) return refuse(res);
    return true;
  }

  /** §4's checks 1–7, in order, all from the headers; then the body, then storeSession. */
  async function receiveSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = SESSION_URL.exec(req.url!)?.[1];
    // The raw path, never decoded: "%2e%2e" is not a session id, and never becomes "..".
    if (!isSessionId(id)) return fail(res, "bad-request", "the URL does not end in a pointcast session id");
    if (req.headers["content-type"] !== HANDOFF_CONTENT_TYPE) {
      return fail(res, "bad-request", `Content-Type must be ${HANDOFF_CONTENT_TYPE}`);
    }
    const declared = req.headers["content-length"];
    if (req.headers["transfer-encoding"] !== undefined || declared === undefined) {
      return fail(res, "length-required", "the body needs a Content-Length (no chunked encoding)");
    }
    const filesHeader = req.headers[HANDOFF_FILES_HEADER.toLowerCase()];
    const parsed = parseFilesHeader(typeof filesHeader === "string" ? filesHeader : undefined);
    if (!parsed.ok) return fail(res, parsed.error, parsed.message);
    const contentLength = Number(declared);
    if (contentLength !== parsed.totalBytes) {
      return fail(res, "bad-request", `Content-Length is ${declared}, but ${HANDOFF_FILES_HEADER} adds up to ${parsed.totalBytes}`);
    }
    if (uploading) return fail(res, "busy", "it is receiving another recording");

    uploading = true;
    let clientGone = false;
    res.once("close", () => {
      if (!res.writableFinished) clientGone = true;
    });
    try {
      if (await sessionFolderExists(options.base, id)) return fail(res, "exists", `a session folder named ${id} already exists`);
      const body = await readBody(req, contentLength);
      // The client went away mid-body: nothing was written, and nobody is waiting for an answer.
      if (body === undefined) return;
      const result = await storeSession({ base: options.base, id, files: parsed.files, body, clientGone: () => clientGone });
      if (result.status !== 201) return fail(res, result.error, result.message);
      log(`stored recording ${id} in ${result.dir}`);
      answer(res, 201, { app: "pointcast", id, dir: result.dir });
    } finally {
      uploading = false;
    }
  }

  listen();
  return {
    listening: () => listening,
    close() {
      closed = true;
      clearTimeout(retryTimer);
      closing ??= new Promise((resolve) => {
        if (!server.listening) resolve();
        else server.close(() => resolve());
      });
      return closing;
    },
  };
}

/**
 * Exactly `length` bytes, or undefined when the client aborts. Buffered (≤ 256 MiB, checked from
 * the headers) instead of streamed to disk: nothing is written until every file is validated.
 */
function readBody(req: IncomingMessage, length: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    // Aborted while the early checks awaited: its 'close' has fired already, and would never come.
    if (req.destroyed) {
      resolve(undefined);
      return;
    }
    const body = Buffer.allocUnsafe(length);
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      // Node's parser already stops at Content-Length; this keeps the copy in bounds regardless.
      if (received + chunk.length > length) {
        req.destroy();
        resolve(undefined);
        return;
      }
      chunk.copy(body, received);
      received += chunk.length;
    });
    req.on("end", () => resolve(received === length ? body : undefined));
    req.on("close", () => resolve(undefined));
    req.on("error", () => resolve(undefined));
  });
}

function refuse(res: ServerResponse): false {
  res.writeHead(403, { ...COMMON_HEADERS, "Content-Length": 0 });
  res.end();
  return false;
}

function answer(res: ServerResponse, status: number, body: object): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...COMMON_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function fail(res: ServerResponse, error: HandoffErrorCode, message: string): void {
  answer(res, HANDOFF_ERROR_STATUS[error], { app: "pointcast", error, message });
}
