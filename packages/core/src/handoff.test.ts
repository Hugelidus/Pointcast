import { describe, expect, it } from "vitest";
import {
  EXTENSION_ID,
  EXTENSION_ID_PATTERN,
  HANDOFF_ERROR_STATUS,
  HANDOFF_MAX_TEXT_FILE_BYTES,
  HANDOFF_MAX_TOTAL_BYTES,
  OFFICIAL_EXTENSION_IDS,
  SESSION_ID_PATTERN,
  cleanDisplayText,
  extensionOrigin,
  fileSetError,
  formatFilesHeader,
  handoffUrl,
  isSessionId,
  orderForHandoff,
  parseErrorAnswer,
  parseFilesHeader,
  parseHelloAnswer,
  parseStoredAnswer,
  sessionPath,
  type HandoffFile,
} from "./handoff";

const ID = "2026-09-28_10-15-00";

describe("parseFilesHeader", () => {
  it("accepts one to four files and sums their sizes", () => {
    expect(parseFilesHeader("session.json=18231")).toEqual({
      ok: true,
      files: [{ name: "session.json", size: 18231 }],
      totalBytes: 18231,
    });
    expect(parseFilesHeader("session.json=10,words.json=20")).toMatchObject({ ok: true, totalBytes: 30 });
    expect(parseFilesHeader("session.json=10,words.json=20,session.md=30")).toMatchObject({ ok: true, totalBytes: 60 });
    expect(parseFilesHeader("session.json=1,words.json=2,session.md=3,audio.wav=4")).toEqual({
      ok: true,
      files: [
        { name: "session.json", size: 1 },
        { name: "words.json", size: 2 },
        { name: "session.md", size: 3 },
        { name: "audio.wav", size: 4 },
      ],
      totalBytes: 10,
    });
    expect(parseFilesHeader("session.json=1,audio.webm=0")).toMatchObject({ ok: true, totalBytes: 1 });
  });

  it.each([
    ["an unknown name", "session.json=1,notes.txt=2", "unexpected file"],
    ["a name in the wrong case", "Session.json=1", "unexpected file"],
    ["a repeated file", "session.json=1,session.json=1", "listed twice"],
    ["a file repeated further on", "session.json=1,words.json=2,session.json=1", "listed twice"],
    ["the wrong order", "words.json=1,session.json=1", "out of order"],
    ["no session.json", "words.json=1,session.md=2", "session.json is missing"],
    ["both audio files", "session.json=1,audio.wav=1,audio.webm=1", "cannot both be sent"],
  ])("refuses %s", (_label, value, message) => {
    const parsed = parseFilesHeader(value);
    expect(parsed).toMatchObject({ ok: false, error: "bad-request" });
    expect(parsed.ok ? "" : parsed.message).toContain(message);
  });

  it.each([
    ["a space after a comma", "session.json=1, words.json=2"],
    ["spaces around =", "session.json = 1"],
    ["a leading space", " session.json=1"],
    ["a leading zero", "session.json=01"],
    ["a negative size", "session.json=-1"],
    ["a non-numeric size", "session.json=abc"],
    ["an exponent", "session.json=1e3"],
    ["a decimal size", "session.json=1.5"],
    ["an empty size", "session.json="],
    ["no =", "session.json"],
    ["a trailing comma", "session.json=1,"],
    ["an 11-digit size", "session.json=12345678901"],
  ])("refuses %s", (_label, value) => {
    expect(parseFilesHeader(value)).toMatchObject({ ok: false, error: "bad-request" });
  });

  it("refuses an empty or missing value", () => {
    expect(parseFilesHeader("")).toMatchObject({ ok: false, error: "bad-request", message: "missing X-Pointcast-Files header" });
    expect(parseFilesHeader(undefined)).toMatchObject({ ok: false, error: "bad-request" });
  });

  it("refuses a value over 512 characters before looking at its entries", () => {
    const value = "session.json=1," + "a".repeat(512 - "session.json=1,".length);
    expect(value).toHaveLength(512);
    expect(parseFilesHeader(value)).toMatchObject({ ok: false, error: "bad-request", message: expect.stringContaining("name=bytes") });
    expect(parseFilesHeader(value + "a")).toMatchObject({
      ok: false,
      error: "bad-request",
      message: "X-Pointcast-Files header is longer than 512 characters",
    });
  });

  it("caps each text file at 32 MiB, but not the audio", () => {
    const max = HANDOFF_MAX_TEXT_FILE_BYTES;
    expect(parseFilesHeader(`session.json=${max}`)).toMatchObject({ ok: true });
    for (const name of ["session.json", "words.json", "session.md"]) {
      const value = name === "session.json" ? `session.json=${max + 1}` : `session.json=1,${name}=${max + 1}`;
      expect(parseFilesHeader(value)).toEqual({ ok: false, error: "too-large", message: `${name} is larger than 32 MiB` });
    }
    expect(parseFilesHeader(`session.json=1,audio.wav=${max + 1}`)).toMatchObject({ ok: true });
    // Ten digits pass the syntax, then the size cap refuses them.
    expect(parseFilesHeader("session.json=9999999999")).toMatchObject({ ok: false, error: "too-large" });
  });

  it("caps the total at 256 MiB", () => {
    const max = HANDOFF_MAX_TOTAL_BYTES;
    expect(parseFilesHeader(`session.json=1,audio.wav=${max - 1}`)).toMatchObject({ ok: true, totalBytes: max });
    expect(parseFilesHeader(`session.json=1,audio.wav=${max}`)).toEqual({
      ok: false,
      error: "too-large",
      message: "the recording's files add up to more than 256 MiB",
    });
  });
});

describe("formatFilesHeader", () => {
  it("writes name=size pairs with no spaces, and parseFilesHeader reads them back", () => {
    const files: HandoffFile[] = [
      { name: "session.json", size: 18231 },
      { name: "words.json", size: 5120 },
      { name: "session.md", size: 2310 },
      { name: "audio.webm", size: 0 },
    ];
    const value = formatFilesHeader(files);
    expect(value).toBe("session.json=18231,words.json=5120,session.md=2310,audio.webm=0");
    expect(parseFilesHeader(value)).toEqual({ ok: true, files, totalBytes: 18231 + 5120 + 2310 });
  });
});

describe("fileSetError", () => {
  it("accepts every valid set and explains an invalid one", () => {
    expect(fileSetError(["session.json"])).toBeUndefined();
    expect(fileSetError(["session.json", "words.json", "session.md", "audio.webm"])).toBeUndefined();
    expect(fileSetError([])).toBe("session.json is missing");
    expect(fileSetError(["session.json", "x.txt"])).toBe('unexpected file "x.txt"');
    expect(fileSetError(["session.md", "session.json"])).toBe(
      "session.json is out of order (expected session.json, words.json, session.md, audio.wav, audio.webm)",
    );
  });
});

describe("orderForHandoff", () => {
  it("sorts the extension's files into protocol order, keeping each object", () => {
    const md = { fileName: "session.md", blob: "md" };
    const words = { fileName: "words.json", blob: "words" };
    const session = { fileName: "session.json", blob: "session" };
    const input = [md, words, session];
    const ordered = orderForHandoff(input);
    expect(ordered).toEqual([session, words, md]);
    expect(ordered![0]).toBe(session);
    expect(input).toEqual([md, words, session]);
  });

  it("returns undefined for a set that cannot be sent", () => {
    expect(orderForHandoff([{ fileName: "session.json" }, { fileName: "x.txt" }])).toBeUndefined();
    expect(orderForHandoff([{ fileName: "words.json" }])).toBeUndefined();
    expect(
      orderForHandoff([{ fileName: "audio.webm" }, { fileName: "session.json" }, { fileName: "audio.wav" }]),
    ).toBeUndefined();
  });
});

describe("isSessionId", () => {
  it("accepts the extension's ids, with or without a same-second suffix", () => {
    expect(isSessionId(ID)).toBe(true);
    expect(isSessionId(`${ID}-2`)).toBe(true);
  });

  it.each(["latest", "..", "../x", ".incoming-1", "2026-09-28", "%2e%2e", `${ID}/x`, `${ID}\n`, ` ${ID}`, `${ID}-`])(
    "refuses %j",
    (value) => {
      expect(isSessionId(value)).toBe(false);
    },
  );

  it("refuses non-strings", () => {
    expect(isSessionId(undefined)).toBe(false);
    expect(isSessionId(20260928)).toBe(false);
  });

  it("keeps the 7 capture groups the CLI's discover.ts reads", () => {
    expect(SESSION_ID_PATTERN.exec(`${ID}-2`)?.slice(1)).toEqual(["2026", "09", "28", "10", "15", "00", "2"]);
    expect(SESSION_ID_PATTERN.exec(ID)?.slice(1)).toEqual(["2026", "09", "28", "10", "15", "00", undefined]);
  });
});

describe("URLs", () => {
  it("builds loopback URLs from the port and path", () => {
    expect(handoffUrl(20547, "/pointcast/v1/hello")).toBe("http://127.0.0.1:20547/pointcast/v1/hello");
    expect(handoffUrl(5542, sessionPath(ID))).toBe(`http://127.0.0.1:5542/pointcast/v1/sessions/${ID}`);
  });

  it("never builds a session path from an id that is not one", () => {
    expect(() => sessionPath("../x")).toThrow('Not a pointcast session id: "../x"');
    expect(() => sessionPath("latest")).toThrow();
  });
});

describe("parseHelloAnswer", () => {
  it("accepts a pointcast hello and keeps only its three fields", () => {
    expect(parseHelloAnswer({ app: "pointcast", protocol: 1, version: "0.2.0", extra: "x" })).toEqual({
      app: "pointcast",
      protocol: 1,
      version: "0.2.0",
    });
    // Another protocol still parses: the caller decides what to tell the user.
    expect(parseHelloAnswer({ app: "pointcast", protocol: 2, version: "9.0.0" })).toMatchObject({ protocol: 2 });
    expect(parseHelloAnswer({ app: "pointcast", protocol: 1, version: "v".repeat(64) })).toBeDefined();
  });

  it.each([
    ["null", null],
    ["a string", "pointcast"],
    ["an array", [{ app: "pointcast", protocol: 1, version: "0.2.0" }]],
    ["another app", { app: "other", protocol: 1, version: "0.2.0" }],
    ["no app", { protocol: 1, version: "0.2.0" }],
    ["a string protocol", { app: "pointcast", protocol: "1", version: "0.2.0" }],
    ["a fractional protocol", { app: "pointcast", protocol: 1.5, version: "0.2.0" }],
    ["no version", { app: "pointcast", protocol: 1 }],
    ["a numeric version", { app: "pointcast", protocol: 1, version: 2 }],
    ["a version over 64 characters", { app: "pointcast", protocol: 1, version: "v".repeat(65) }],
  ])("refuses %s", (_label, value) => {
    expect(parseHelloAnswer(value)).toBeUndefined();
  });
});

describe("parseStoredAnswer", () => {
  const dir = `~\\Downloads\\pointcast\\${ID}`;

  it("accepts the answer for this session, with its display folder", () => {
    expect(parseStoredAnswer({ app: "pointcast", id: ID, dir, extra: 1 }, ID)).toEqual({ app: "pointcast", id: ID, dir });
    expect(parseStoredAnswer({ app: "pointcast", id: ID, dir: "d".repeat(1024) }, ID)).toBeDefined();
  });

  it.each([
    ["another session's id", { app: "pointcast", id: `${ID}-2`, dir }],
    ["another app", { app: "other", id: ID, dir }],
    ["a dir with a newline", { app: "pointcast", id: ID, dir: `${dir}\nSaved elsewhere` }],
    ["a dir with a C1 control character", { app: "pointcast", id: ID, dir: `${dir}\u009b` }],
    ["an empty dir", { app: "pointcast", id: ID, dir: "" }],
    ["a dir over 1024 characters", { app: "pointcast", id: ID, dir: "d".repeat(1025) }],
    ["no dir", { app: "pointcast", id: ID }],
    ["null", null],
  ])("refuses %s", (_label, value) => {
    expect(parseStoredAnswer(value, ID)).toBeUndefined();
  });
});

describe("parseErrorAnswer", () => {
  it("accepts every known error code", () => {
    for (const error of Object.keys(HANDOFF_ERROR_STATUS)) {
      expect(parseErrorAnswer({ app: "pointcast", error, message: "m" })).toEqual({ app: "pointcast", error, message: "m" });
    }
  });

  it("cleans the message for display", () => {
    const parsed = parseErrorAnswer({ app: "pointcast", error: "write-failed", message: "disk\u0000 full\u001b[31m" + "!".repeat(400) });
    expect(parsed?.message).toHaveLength(300);
    expect(parsed?.message.startsWith("disk full[31m!")).toBe(true);
    expect(parsed?.message.endsWith("…")).toBe(true);
  });

  it.each([
    ["an unknown code", { app: "pointcast", error: "teapot", message: "m" }],
    ["an inherited property name", { app: "pointcast", error: "toString", message: "m" }],
    ["no message", { app: "pointcast", error: "busy" }],
    ["another app", { app: "other", error: "busy", message: "m" }],
    ["a string", "busy"],
  ])("refuses %s", (_label, value) => {
    expect(parseErrorAnswer(value)).toBeUndefined();
  });
});

describe("cleanDisplayText", () => {
  it("removes C0, DEL and C1 control characters", () => {
    expect(cleanDisplayText("a\u0000b\tc\nd\re\u001bf\u007fg\u0085h\u009fi", 100)).toBe("abcdefghi");
  });

  it("truncates to maxLength with an ellipsis, and leaves short text alone", () => {
    expect(cleanDisplayText("abcdefghij", 5)).toBe("abcd…");
    expect(cleanDisplayText("abcde", 5)).toBe("abcde");
    expect(cleanDisplayText("Ünïcödé ✓", 20)).toBe("Ünïcödé ✓");
  });
});

describe("HANDOFF_ERROR_STATUS", () => {
  it("maps each error to its HTTP status", () => {
    expect(HANDOFF_ERROR_STATUS).toEqual({
      "unknown-extension": 403,
      "bad-request": 400,
      "length-required": 411,
      "too-large": 413,
      exists: 409,
      busy: 503,
      "not-found": 404,
      "write-failed": 500,
    });
  });
});

describe("extension id", () => {
  it("is a Chrome id and is accepted out of the box", () => {
    expect(EXTENSION_ID).toMatch(EXTENSION_ID_PATTERN);
    expect(OFFICIAL_EXTENSION_IDS).toContain(EXTENSION_ID);
    for (const id of OFFICIAL_EXTENSION_IDS) expect(id).toMatch(EXTENSION_ID_PATTERN);
  });

  it("only matches 32 letters a-p", () => {
    expect("a".repeat(32)).toMatch(EXTENSION_ID_PATTERN);
    expect("a".repeat(31)).not.toMatch(EXTENSION_ID_PATTERN);
    expect("q".repeat(32)).not.toMatch(EXTENSION_ID_PATTERN);
    expect("A".repeat(32)).not.toMatch(EXTENSION_ID_PATTERN);
  });

  it("builds the Origin Chrome sends for it", () => {
    expect(extensionOrigin(EXTENSION_ID)).toBe(`chrome-extension://${EXTENSION_ID}`);
  });
});
