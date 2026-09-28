import { describe, expect, it, vi } from "vitest";
import type { ProcessedSession, SessionFileBlob } from "./session-processor";
import { handOff, publishFiles, type HandoffDeps, type HandoffOutcome } from "./handoff";

const SESSION_ID = "2026-09-28_10-15-00";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const PORT = 5542;

/** As processSession lists them: session.md first, for "Show in folder". */
const FILES: SessionFileBlob[] = [
  { fileName: "session.md", blob: new Blob(["# 2026-09-28_10-15-00\n"]) },
  { fileName: "words.json", blob: new Blob(['{"words":[]}']) },
  { fileName: "session.json", blob: new Blob(['{"id":"2026-09-28_10-15-00","events":[]}']) },
];

type Route = (init: RequestInit) => Response | Promise<Response>;

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const HELLO_OK: Route = () => json(200, { app: "pointcast", protocol: 1, version: "0.2.0" });
const STORED: Route = () => json(201, { app: "pointcast", id: SESSION_ID, dir: `~\\Downloads\\pointcast\\${SESSION_ID}` });
/** Never answers, until the request's signal aborts it (a timeout). */
const HANG: Route = (init) =>
  new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
const REFUSED_CONNECTION: Route = () => Promise.reject(new TypeError("Failed to fetch"));

/** A fake 127.0.0.1: answers the hello and the upload with `routes`, and records every request. */
function receiver(routes: { hello?: Route; upload?: Route }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const route = url.endsWith("/pointcast/v1/hello") ? routes.hello : routes.upload;
    return (route ?? REFUSED_CONNECTION)(init ?? {});
  }) as typeof fetch;
  const deps: HandoffDeps = { fetch: fetchFn, port: PORT, extensionId: EXTENSION_ID, helloTimeoutMs: 50, uploadTimeoutMs: 50 };
  return { deps, calls };
}

const warningOf = (outcome: HandoffOutcome): string => (outcome.kind === "refused" ? outcome.warning : "");

describe("handOff: the requests", () => {
  it("says hello, then posts the files in protocol order, as the receiver's gate expects them", async () => {
    const { deps, calls } = receiver({ hello: HELLO_OK, upload: STORED });
    await handOff(SESSION_ID, FILES, deps);

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:5542/pointcast/v1/hello",
      `http://127.0.0.1:5542/pointcast/v1/sessions/${SESSION_ID}`,
    ]);
    for (const { init } of calls) {
      expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
      // "no-referrer" would make Chrome send `Origin: null`, which the receiver refuses.
      expect(init.referrerPolicy).toBeUndefined();
      expect(new Headers(init.headers).get("X-Pointcast-Handoff")).toBe("1");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls[0]?.init.body).toBeUndefined();

    const upload = calls[1].init;
    const headers = new Headers(upload.headers);
    const [md, words, session] = FILES.map((file) => file.blob);
    expect(headers.get("X-Pointcast-Files")).toBe(`session.json=${session.size},words.json=${words.size},session.md=${md.size}`);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    const body = new Uint8Array(await (upload.body as Blob).arrayBuffer());
    const expected = new Uint8Array(await new Blob([session, words, md]).arrayBuffer());
    expect(body).toEqual(expected);
  });

  it("sends nothing when the files are not a session (a bug upstream), and says so", async () => {
    const { deps, calls } = receiver({ hello: HELLO_OK, upload: STORED });
    const outcome = await handOff(SESSION_ID, [...FILES, { fileName: "x.txt", blob: new Blob(["x"]) }], deps);
    expect(outcome.kind).toBe("refused");
    expect(warningOf(outcome)).toMatch(/internal error: unexpected files .*x\.txt.*Chrome's downloads saved it instead/);
    expect(await handOff("../evil", FILES, deps)).toMatchObject({ kind: "refused" });
    expect(calls).toEqual([]);
  });
});

describe("handOff: no pointcast MCP server there (downloads, silently)", () => {
  const cases: [string, Route][] = [
    ["nothing listens", REFUSED_CONNECTION],
    ["a program that never answers", HANG],
    ["a web server", () => new Response("<!doctype html><title>Hi</title>", { status: 200, headers: { "content-type": "text/html" } })],
    ["another app's JSON", () => json(200, { app: "other", protocol: 1, version: "1" })],
    ["an answer longer than any of pointcast's", () => json(200, { app: "pointcast", protocol: 1, version: "0.2.0", padding: "x".repeat(5_000) })],
    ["an error page", () => new Response("Internal Server Error", { status: 500 })],
    ["a gate refusal (empty 403)", () => new Response(null, { status: 403 })],
  ];
  for (const [name, hello] of cases) {
    it(`${name}: no upload`, async () => {
      const { deps, calls } = receiver({ hello, upload: STORED });
      expect(await handOff(SESSION_ID, FILES, deps)).toEqual({ kind: "no-receiver" });
      expect(calls).toHaveLength(1);
    });
  }
});

describe("handOff: a pointcast MCP server that will not take it (downloads, with a warning)", () => {
  it("speaks another protocol: says to update, and uploads nothing", async () => {
    const { deps, calls } = receiver({ hello: () => json(200, { app: "pointcast", protocol: 2, version: "1.0.0" }), upload: STORED });
    const outcome = await handOff(SESSION_ID, FILES, deps);
    expect(warningOf(outcome)).toMatch(/speaks another version of the handoff: update your agent's pointcast plugin or extension \(or the pointcast@ version in its MCP config\)/);
    expect(calls).toHaveLength(1);
  });

  it("does not accept this build: names the id and the setting that accepts it", async () => {
    const hello = () =>
      json(403, { app: "pointcast", error: "unknown-extension", message: `This server does not accept extension ${EXTENSION_ID}.` });
    const { deps, calls } = receiver({ hello, upload: STORED });
    const warning = warningOf(await handOff(SESSION_ID, FILES, deps));
    expect(warning).toContain(`does not accept this build of the extension (id ${EXTENSION_ID})`);
    expect(warning).toContain(`set POINTCAST_EXTENSION_IDS=${EXTENSION_ID} for the server`);
    expect(calls).toHaveLength(1);
  });

  it("refuses the upload: quotes the server's reason", async () => {
    for (const [status, error, message] of [
      [409, "exists", `a session folder named ${SESSION_ID} already exists`],
      [413, "too-large", "session.md is larger than 32 MiB"],
      [500, "write-failed", "ENOSPC: no space left on device"],
    ] as const) {
      const { deps } = receiver({ hello: HELLO_OK, upload: () => json(status, { app: "pointcast", error, message }) });
      expect(await handOff(SESSION_ID, FILES, deps)).toEqual({
        kind: "refused",
        warning: `The pointcast MCP server did not take this recording (${message}), so Chrome's downloads saved it instead.`,
      });
    }
  });

  it("keeps control characters from a server's message out of the popup", async () => {
    const upload = () => json(500, { app: "pointcast", error: "write-failed", message: "disk\u0007 full\u009b" });
    const { deps } = receiver({ hello: HELLO_OK, upload });
    expect(warningOf(await handOff(SESSION_ID, FILES, deps))).toContain("(disk full)");
  });

  it("gives the HTTP status when the answer is not pointcast's", async () => {
    const { deps } = receiver({ hello: HELLO_OK, upload: () => new Response("Bad Gateway", { status: 502 }) });
    expect(warningOf(await handOff(SESSION_ID, FILES, deps))).toContain("(HTTP 502)");
  });

  it("treats a 404 as another version of the handoff", async () => {
    const upload = () => json(404, { app: "pointcast", error: "not-found", message: "no such path" });
    const { deps } = receiver({ hello: HELLO_OK, upload });
    expect(warningOf(await handOff(SESSION_ID, FILES, deps))).toMatch(/speaks another version of the handoff/);
  });

  it("does not trust a 201 for another session or with a folder that could spoof the popup", async () => {
    for (const answer of [
      { app: "pointcast", id: "2026-09-28_10-15-01", dir: "~\\Downloads\\pointcast\\2026-09-28_10-15-01" },
      { app: "pointcast", id: SESSION_ID, dir: "~\\Downloads\\pointcast\nSaved to Downloads" },
      { app: "pointcast", id: SESSION_ID },
    ]) {
      const { deps } = receiver({ hello: HELLO_OK, upload: () => json(201, answer) });
      const outcome = await handOff(SESSION_ID, FILES, deps);
      expect(outcome.kind).toBe("refused");
      expect(warningOf(outcome)).toContain("(it gave an unexpected answer)");
    }
  });

  it("says so when the upload times out or the connection fails", async () => {
    const slow = receiver({ hello: HELLO_OK, upload: HANG });
    expect(warningOf(await handOff(SESSION_ID, FILES, slow.deps))).toContain("(it did not answer in time)");
    const gone = receiver({ hello: HELLO_OK, upload: REFUSED_CONNECTION });
    expect(warningOf(await handOff(SESSION_ID, FILES, gone.deps))).toContain("(the connection failed)");
  });
});

describe("handOff: stored", () => {
  it("returns the folder the server reports", async () => {
    const { deps } = receiver({ hello: HELLO_OK, upload: STORED });
    expect(await handOff(SESSION_ID, FILES, deps)).toEqual({ kind: "handed-off", dir: `~\\Downloads\\pointcast\\${SESSION_ID}` });
  });

  it("also hands off a session whose transcription failed (session.json and its audio)", async () => {
    const { deps, calls } = receiver({ hello: HELLO_OK, upload: STORED });
    const files = [
      { fileName: "session.json", blob: new Blob(["{}"]) },
      { fileName: "audio.wav", blob: new Blob([new Uint8Array(44)]) },
    ];
    expect((await handOff(SESSION_ID, files, deps)).kind).toBe("handed-off");
    expect(new Headers(calls[1]?.init.headers).get("X-Pointcast-Files")).toBe("session.json=2,audio.wav=44");
  });
});

describe("publishFiles", () => {
  const processed: ProcessedSession = { files: FILES, markdown: "# spec", copied: true, audioMs: 12_000 };

  function deps(outcome: HandoffOutcome | Error) {
    return {
      handOff: vi.fn(async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }),
      createObjectURL: vi.fn((blob: Blob) => `blob:${FILES.find((file) => file.blob === blob)?.fileName}`),
    };
  }

  it("reports a handed-off session with no files to download", async () => {
    const d = deps({ kind: "handed-off", dir: "~/Downloads/pointcast/x" });
    const result = await publishFiles(SESSION_ID, processed, { handoff: true }, d);
    expect(result).toEqual({ markdown: "# spec", copied: true, audioMs: 12_000, files: [], handedOff: { dir: "~/Downloads/pointcast/x" } });
    expect(d.handOff).toHaveBeenCalledWith(SESSION_ID, FILES);
    expect(d.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to blob: URLs for chrome.downloads, silently when nobody was there", async () => {
    const result = await publishFiles(SESSION_ID, processed, { handoff: true }, deps({ kind: "no-receiver" }));
    expect(result).toEqual({
      markdown: "# spec",
      copied: true,
      audioMs: 12_000,
      files: [
        { fileName: "session.md", url: "blob:session.md" },
        { fileName: "words.json", url: "blob:words.json" },
        { fileName: "session.json", url: "blob:session.json" },
      ],
    });
  });

  it("falls back with the server's reason added to the warning", async () => {
    const refusal = deps({ kind: "refused", warning: "Refused." });
    expect((await publishFiles(SESSION_ID, processed, { handoff: true }, refusal)).warning).toBe("Refused.");
    const withWarning = { ...processed, warning: "Microphone ended early." };
    const result = await publishFiles(SESSION_ID, withWarning, { handoff: true }, refusal);
    expect(result.warning).toBe("Microphone ended early. Refused.");
    expect(result.files).toHaveLength(3);
    expect(result.handedOff).toBeUndefined();
  });

  it("still downloads the recording if the handoff throws (a bug)", async () => {
    const result = await publishFiles(SESSION_ID, processed, { handoff: true }, deps(new Error("boom")));
    expect(result.files).toHaveLength(3);
    expect(result.warning).toContain("(boom)");
  });

  it("never tries a server when the setting is off, or when there is nothing to save", async () => {
    const off = deps({ kind: "handed-off", dir: "x" });
    expect((await publishFiles(SESSION_ID, processed, { handoff: false }, off)).files).toHaveLength(3);
    expect(off.handOff).not.toHaveBeenCalled();

    const empty = deps({ kind: "handed-off", dir: "x" });
    const nothing = { files: [], copied: false, audioMs: 0, error: "Processing failed." };
    expect(await publishFiles(SESSION_ID, nothing, { handoff: true }, empty)).toEqual({ ...nothing, files: [] });
    expect(empty.handOff).not.toHaveBeenCalled();
  });
});
