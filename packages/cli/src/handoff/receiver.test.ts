import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXTENSION_ID,
  HANDOFF_HELLO_PATH,
  HANDOFF_SESSIONS_PATH,
  extensionOrigin,
  formatFilesHeader,
  parseErrorAnswer,
  parseHelloAnswer,
  parseStoredAnswer,
  sessionPath,
} from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, listSessions, resolveSessionDirById } from "../mcp/sessions";
import { startHandoffReceiver, type HandoffReceiver, type HandoffReceiverOptions } from "./receiver";
import { displayPath } from "./store";
import { recording, SESSION_ID, type Recording } from "./test-support";

/**
 * The receiver over real loopback HTTP, on a port the OS picks (never 20547, the one a real
 * extension talks to). Requests use raw node:http, so Host and Origin can be forged the way a
 * DNS-rebound or cross-site page would try.
 */

const VERSION = "9.9.9-test";
const OTHER_ID = "2026-09-28_10-15-01";
/** A folder that already exists: an upload for it answers 409, or 503 while another one is in progress. */
const PROBE_ID = "2026-01-01_00-00-00";
const EXTENSION_HEADERS = { Origin: extensionOrigin(EXTENSION_ID), "X-Pointcast-Handoff": "1" };

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: unknown;
}

interface RequestOptions {
  method?: string;
  path?: string;
  headers?: Record<string, string | number>;
}

/** Starts a request and leaves the body to the caller; `answer` settles once the response is read. */
function open(port: number, { method = "POST", path = HANDOFF_HELLO_PATH, headers = {} }: RequestOptions) {
  let req!: ClientRequest;
  const answer = new Promise<Answer>((resolve, reject) => {
    req = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode!, headers: res.headers, text, json });
      });
    });
    // After an early answer the server closes the connection under a body still being sent.
    req.on("error", reject);
  });
  return { req, answer };
}

function send(port: number, options: RequestOptions & { body?: Buffer | string } = {}): Promise<Answer> {
  const { req, answer } = open(port, options);
  req.end(options.body);
  return answer;
}

function uploadHeaders(rec: Recording): Record<string, string | number> {
  return {
    ...EXTENSION_HEADERS,
    "Content-Type": "application/octet-stream",
    "X-Pointcast-Files": formatFilesHeader(rec.files),
    "Content-Length": rec.body.length,
  };
}

function upload(port: number, id: string, rec: Recording = recording(id)): Promise<Answer> {
  return send(port, { path: sessionPath(id), headers: uploadHeaders(rec), body: rec.body });
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("handoff receiver", () => {
  let base: string;
  let receivers: HandoffReceiver[];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-handoff-receiver-"));
    receivers = [];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(receivers.map((receiver) => receiver.close()));
    rmSync(base, { recursive: true, force: true });
  });

  function startReceiver(overrides: Partial<HandoffReceiverOptions> = {}) {
    const logs: string[] = [];
    const receiver = startHandoffReceiver({
      base,
      port: 0,
      allowedExtensionIds: new Set([EXTENSION_ID]),
      version: VERSION,
      log: (message) => logs.push(message),
      ...overrides,
    });
    receivers.push(receiver);
    return { receiver, logs };
  }

  async function listening(overrides: Partial<HandoffReceiverOptions> = {}) {
    const started = startReceiver(overrides);
    return { ...started, port: await started.receiver.listening() };
  }

  const sessionsIn = () => (existsSync(base) ? readdirSync(base).sort() : []);

  /** Waits until an upload is in progress: a probe for an existing folder then gets 503, not 409. */
  async function untilBusy(port: number): Promise<void> {
    await until(async () => (await upload(port, PROBE_ID)).status === 503, "the upload to start");
  }

  it("answers the hello of the pointcast extension, with no CORS headers", async () => {
    const { port, logs } = await listening();
    const hello = await send(port, { headers: EXTENSION_HEADERS });

    expect(hello.status).toBe(200);
    expect(hello.json).toEqual({ app: "pointcast", protocol: 1, version: VERSION });
    expect(parseHelloAnswer(hello.json)).toEqual(hello.json);
    expect(hello.headers).toMatchObject({
      connection: "close",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-type": "application/json; charset=utf-8",
    });
    expect(Object.keys(hello.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(logs).toEqual([`receiving recordings from the extension on 127.0.0.1:${port} (saved in ${displayPath(base)})`]);
  });

  const refusals: Array<[string, (port: number, rec: Recording) => RequestOptions]> = [
    ["a web page's Origin", (_, rec) => ({ headers: { ...uploadHeaders(rec), Origin: "http://localhost:5173" } })],
    ['Origin "null"', (_, rec) => ({ headers: { ...uploadHeaders(rec), Origin: "null" } })],
    ["no Origin", (_, rec) => ({ headers: { ...uploadHeaders(rec), Origin: "" } })],
    ["an Origin that only looks like an extension", (_, rec) => ({ headers: { ...uploadHeaders(rec), Origin: "chrome-extension://abc" } })],
    ["no marker header", (_, rec) => ({ headers: { ...uploadHeaders(rec), "X-Pointcast-Handoff": "" } })],
    ["a wrong marker", (_, rec) => ({ headers: { ...uploadHeaders(rec), "X-Pointcast-Handoff": "2" } })],
    ["a DNS-rebinding Host", (port, rec) => ({ headers: { ...uploadHeaders(rec), Host: `evil.test:${port}` } })],
    ["Host localhost", (port, rec) => ({ headers: { ...uploadHeaders(rec), Host: `localhost:${port}` } })],
    ["another port in Host", (port, rec) => ({ headers: { ...uploadHeaders(rec), Host: `127.0.0.1:${port + 1}` } })],
    ["GET", (_, rec) => ({ method: "GET", headers: { ...EXTENSION_HEADERS, "Content-Length": rec.body.length } })],
    [
      "a Private Network Access preflight",
      () => ({
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "x-pointcast-handoff",
          "Access-Control-Request-Private-Network": "true",
        },
      }),
    ],
    [
      "a page's no-cors text/plain POST",
      (_, rec) => ({ headers: { Origin: "http://127.0.0.1:5511", "Content-Type": "text/plain", "Content-Length": rec.body.length } }),
    ],
  ];

  it.each(refusals)("refuses %s with an empty 403 and writes nothing", async (_, options) => {
    const { port } = await listening();
    const rec = recording();
    const built = options(port, rec);
    // An empty header value is how these cases leave a header out.
    const headers = Object.fromEntries(Object.entries(built.headers ?? {}).filter(([, value]) => value !== ""));
    const answer = await send(port, { path: sessionPath(SESSION_ID), ...built, headers, body: built.method === "OPTIONS" ? undefined : rec.body });

    expect(answer.status).toBe(403);
    expect(answer.text).toBe("");
    expect(answer.headers).toMatchObject({ connection: "close", "content-length": "0" });
    expect(Object.keys(answer.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(sessionsIn()).toEqual([]);
  });

  it("tells an extension that is not allowed what to set, and accepts it once allowed", async () => {
    const fork = "a".repeat(32);
    const headers = { ...EXTENSION_HEADERS, Origin: extensionOrigin(fork) };
    const { port } = await listening();

    const refused = await send(port, { headers });
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({
      app: "pointcast",
      error: "unknown-extension",
      message: `This pointcast MCP server does not accept extension ${fork}. Set POINTCAST_EXTENSION_IDS=${fork} for it.`,
    });
    expect(parseErrorAnswer(refused.json)?.error).toBe("unknown-extension");

    const allowing = await listening({ allowedExtensionIds: new Set([EXTENSION_ID, fork]) });
    expect((await send(allowing.port, { headers })).status).toBe(200);
  });

  it("stores an upload in the folder the MCP tools read, byte for byte", async () => {
    const { port, logs } = await listening();
    const rec = recording();
    const answer = await upload(port, SESSION_ID, rec);

    const dir = displayPath(join(base, SESSION_ID));
    expect(answer.status).toBe(201);
    expect(answer.json).toEqual({ app: "pointcast", id: SESSION_ID, dir });
    expect(parseStoredAnswer(answer.json, SESSION_ID)).toEqual(answer.json);
    expect(logs).toContain(`stored recording ${SESSION_ID} in ${dir}`);

    // No staging folder is left: only the session.
    expect(sessionsIn()).toEqual([SESSION_ID]);
    expect(readdirSync(join(base, SESSION_ID)).sort()).toEqual(rec.files.map((file) => file.name).sort());
    for (const file of rec.files) expect(readFileSync(join(base, SESSION_ID, file.name)).equals(rec.bytes[file.name]!)).toBe(true);

    expect((await listSessions({ dirFlag: base })).map((session) => session.id)).toEqual([SESSION_ID]);
    const { dir: latest } = await resolveSessionDirById({ dirFlag: base }, "latest");
    expect((await getSession(latest)).markdown).toBe(rec.bytes["session.md"]!.toString("utf8"));
  });

  it("stores a recording with only session.json", async () => {
    const { port } = await listening();
    const rec = recording(SESSION_ID, { "words.json": null, "session.md": null, "audio.wav": null });
    expect((await upload(port, SESSION_ID, rec)).status).toBe(201);
    expect(readdirSync(join(base, SESSION_ID))).toEqual(["session.json"]);
  });

  const badRequests: Array<[string, () => RequestOptions & { body: Buffer }, RegExp]> = [
    ["a URL id that is not session.json's", () => withRecording(recording(SESSION_ID), OTHER_ID), /session\.json's id/],
    ['the id "latest"', () => withRecording(recording(), "latest"), /does not end in a pointcast session id/],
    ['the id ".."', () => withRecording(recording(), ".."), /does not end in a pointcast session id/],
    ['the id "%2e%2e"', () => withRecording(recording(), "%2e%2e"), /does not end in a pointcast session id/],
    ["a path under the id", () => withRecording(recording(), `${SESSION_ID}/session.json`), /does not end in a pointcast session id/],
    ["a query string", () => withRecording(recording(), `${SESSION_ID}?x=1`), /does not end in a pointcast session id/],
    ["a bad files header", () => withHeaders(recording(), { "X-Pointcast-Files": "session.json=01" }), /^bad X-Pointcast-Files entry/],
    ["no files header", () => withHeaders(recording(), { "X-Pointcast-Files": "" }), /^missing X-Pointcast-Files header$/],
    [
      "a Content-Length that is not the files' total",
      () => {
        const rec = recording();
        const body = Buffer.concat([rec.body, Buffer.from("x")]);
        return { ...withHeaders(rec, { "Content-Length": body.length }), body };
      },
      /^Content-Length is \d+, but X-Pointcast-Files adds up to \d+$/,
    ],
    ["an invalid session.json", () => withRecording(recording(SESSION_ID, { "session.json": '{"id":"x"}' })), /^session\.json: /],
    ["an invalid words.json", () => withRecording(recording(SESSION_ID, { "words.json": "[]" })), /^words\.json: /],
    ["a session.md that is not UTF-8", () => withRecording(recording(SESSION_ID, { "session.md": Buffer.from([0xc3, 0x28]) })), /UTF-8/],
    ["a text/plain body", () => withHeaders(recording(), { "Content-Type": "text/plain" }), /^Content-Type must be application\/octet-stream$/],
  ];

  function withRecording(rec: Recording, id: string = SESSION_ID): RequestOptions & { body: Buffer } {
    return { path: HANDOFF_SESSIONS_PATH + id, headers: uploadHeaders(rec), body: rec.body };
  }
  function withHeaders(rec: Recording, headers: Record<string, string | number>) {
    const merged = Object.fromEntries(Object.entries({ ...uploadHeaders(rec), ...headers }).filter(([, value]) => value !== ""));
    return { ...withRecording(rec), headers: merged };
  }

  it.each(badRequests)("answers 400 to %s and writes nothing", async (_, build, message) => {
    const { port } = await listening();
    const answer = await send(port, build());
    expect(answer.status).toBe(400);
    expect(parseErrorAnswer(answer.json)).toEqual({ app: "pointcast", error: "bad-request", message: expect.stringMatching(message) });
    expect(sessionsIn()).toEqual([]);
  });

  it("answers 404 to another path", async () => {
    const { port } = await listening();
    const answer = await send(port, { path: "/pointcast/v2/hello", headers: EXTENSION_HEADERS });
    expect(answer.status).toBe(404);
    expect(parseErrorAnswer(answer.json)?.error).toBe("not-found");
  });

  it("answers 411 to a chunked body", async () => {
    const { port } = await listening();
    const rec = recording();
    const { "Content-Length": _, ...headers } = uploadHeaders(rec);
    const { req, answer } = open(port, { path: sessionPath(SESSION_ID), headers });
    req.write(rec.body.subarray(0, 10));
    req.end(rec.body.subarray(10));
    expect(parseErrorAnswer((await answer).json)?.error).toBe("length-required");
    expect((await answer).status).toBe(411);
    expect(sessionsIn()).toEqual([]);
  });

  it("answers 413 from the headers alone, before the body arrives", async () => {
    const { port } = await listening();
    const size = 32 * 1024 * 1024 + 1;
    const { req, answer } = open(port, {
      path: sessionPath(SESSION_ID),
      headers: { ...uploadHeaders(recording()), "X-Pointcast-Files": `session.json=${size}`, "Content-Length": size },
    });
    // The client streams slowly: one small chunk, then nothing until the answer is in.
    req.write(Buffer.alloc(1024));
    const result = await answer;
    req.destroy();

    expect(result.status).toBe(413);
    expect(parseErrorAnswer(result.json)).toEqual({ app: "pointcast", error: "too-large", message: "session.json is larger than 32 MiB" });
    expect(sessionsIn()).toEqual([]);
  });

  it("answers 409 when the session folder exists, and leaves that folder alone", async () => {
    mkdirSync(join(base, SESSION_ID));
    writeFileSync(join(base, SESSION_ID, "session.json"), "mine");
    const { port } = await listening();

    const answer = await upload(port, SESSION_ID);
    expect(answer.status).toBe(409);
    expect(parseErrorAnswer(answer.json)).toEqual({ app: "pointcast", error: "exists", message: `a session folder named ${SESSION_ID} already exists` });
    expect(sessionsIn()).toEqual([SESSION_ID]);
    expect(readdirSync(join(base, SESSION_ID))).toEqual(["session.json"]);
    expect(readFileSync(join(base, SESSION_ID, "session.json"), "utf8")).toBe("mine");
  });

  it("writes nothing for a client that aborts mid-body, and takes the next upload", async () => {
    mkdirSync(join(base, PROBE_ID));
    const { port } = await listening();
    const rec = recording();
    const { req, answer } = open(port, { path: sessionPath(SESSION_ID), headers: uploadHeaders(rec) });
    answer.catch(() => {});
    req.write(rec.body.subarray(0, 100));
    await untilBusy(port);

    req.destroy();
    await until(async () => (await upload(port, PROBE_ID)).status === 409, "the aborted upload to end");
    expect(sessionsIn()).toEqual([PROBE_ID]);

    expect((await upload(port, SESSION_ID)).status).toBe(201);
    expect(sessionsIn()).toEqual([PROBE_ID, SESSION_ID]);
  });

  it("answers 503 to a second upload while one is in progress", async () => {
    mkdirSync(join(base, PROBE_ID));
    const { port } = await listening();
    const rec = recording();
    const first = open(port, { path: sessionPath(SESSION_ID), headers: uploadHeaders(rec) });
    first.req.write(rec.body.subarray(0, 100));
    await untilBusy(port);

    const second = await upload(port, OTHER_ID);
    expect(second.status).toBe(503);
    expect(parseErrorAnswer(second.json)).toEqual({ app: "pointcast", error: "busy", message: "it is receiving another recording" });

    first.req.end(rec.body.subarray(100));
    expect((await first.answer).status).toBe(201);
    expect(sessionsIn()).toEqual([PROBE_ID, SESSION_ID]);
  });

  it("waits for the port while another receiver holds it, saying so once, and takes over when it closes", async () => {
    const first = await listening();
    const second = startReceiver({ port: first.port, retryMs: 20 });
    let bound: number | undefined;
    void second.receiver.listening().then((port) => (bound = port));

    await until(() => second.logs.length > 0, "the in-use line");
    await sleep(200);
    expect(second.logs).toEqual([
      `127.0.0.1:${first.port} is in use (another pointcast MCP server receives the recordings, or another program); retrying every 0.02 s`,
    ]);
    expect(bound).toBeUndefined();

    await first.receiver.close();
    expect(await second.receiver.listening()).toBe(first.port);
    expect(second.logs[1]).toMatch(/^receiving recordings from the extension on /);
    expect((await send(first.port, { headers: EXTENSION_HEADERS })).status).toBe(200);
  });

  it("stops retrying once closed", async () => {
    const first = await listening();
    const second = startReceiver({ port: first.port, retryMs: 20 });
    await until(() => second.logs.length > 0, "the in-use line");
    await second.receiver.close();
    await first.receiver.close();
    await sleep(100);
    expect(second.logs).toHaveLength(1);
  });

  it("can be closed twice, and then refuses connections", async () => {
    const { receiver, port } = await listening();
    await Promise.all([receiver.close(), receiver.close()]);
    await receiver.close();
    await expect(send(port, { headers: EXTENSION_HEADERS })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("never writes to stdout, the MCP channel, and logs to stderr", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const consoleLog = vi.spyOn(console, "log");
    const consoleInfo = vi.spyOn(console, "info");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const receiver = startHandoffReceiver({ base, port: 0, allowedExtensionIds: new Set([EXTENSION_ID]), version: VERSION });
    receivers.push(receiver);
    const port = await receiver.listening();

    await send(port, { headers: EXTENSION_HEADERS });
    await send(port, { headers: { Origin: "http://localhost:5173" } });
    await send(port, withHeaders(recording(), { "X-Pointcast-Files": "nope" }));
    expect((await upload(port, SESSION_ID)).status).toBe(201);

    expect(stdout).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringMatching(/^\[pointcast\] receiving recordings from the extension on 127\.0\.0\.1:\d+ /),
      `[pointcast] stored recording ${SESSION_ID} in ${displayPath(join(base, SESSION_ID))}`,
    ]);
  });
});
