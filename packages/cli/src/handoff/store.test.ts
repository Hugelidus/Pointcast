import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { displayPath, sessionFolderExists, STAGING_PREFIX, storeSession, sweepStaging, type StoreFs } from "./store";
import { recording, SESSION_ID } from "./test-support";

const errno = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("storeSession", () => {
  let root: string;
  let base: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pointcast-handoff-store-"));
    // Not created yet: storeSession creates the sessions folder, as Chrome's first download would.
    base = join(root, "pointcast");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Every rename is recorded; `failures` are thrown by the first calls, in order. */
  function renameFailing(...failures: Array<Error | (() => Error)>): { fs: StoreFs; calls: number } {
    const spy = { fs: undefined as unknown as StoreFs, calls: 0 };
    spy.fs = {
      ...fsPromises,
      rename: async (from, to) => {
        const failure = failures[spy.calls++];
        if (failure !== undefined) throw typeof failure === "function" ? failure() : failure;
        return fsPromises.rename(from, to);
      },
    };
    return spy;
  }

  it("stores every file byte for byte in <base>/<id>, through a staging folder it renames", async () => {
    const { files, body, bytes } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body });

    expect(result).toEqual({ status: 201, id: SESSION_ID, dir: displayPath(join(base, SESSION_ID)) });
    expect(readdirSync(base)).toEqual([SESSION_ID]);
    expect(readdirSync(join(base, SESSION_ID)).sort()).toEqual(["audio.wav", "session.json", "session.md", "words.json"]);
    for (const file of files) expect(readFileSync(join(base, SESSION_ID, file.name)).equals(bytes[file.name]!)).toBe(true);
  });

  it("validates every file before writing anything", async () => {
    const { files, body } = recording(SESSION_ID, { "words.json": JSON.stringify({ schemaVersion: 1, engine: "x", words: "no" }) });
    expect(await storeSession({ base, id: SESSION_ID, files, body })).toEqual({
      status: 400,
      error: "bad-request",
      // The validator's sentence, without its final period: the extension shows it inside "(…)".
      message: 'words.json: "words" must be an array',
    });
    expect(existsSync(base)).toBe(false);
  });

  it.each([
    ["an id that is not the URL's", { "session.json": recording("2026-09-28_10-15-01").bytes["session.json"]! }, /session\.json's id "2026-09-28_10-15-01" is not the 2026-09-28_10-15-00 in the URL/],
    ["a session.json that is not JSON", { "session.json": "{" }, /^session\.json is not valid JSON: /],
    ["a session.json that is not a session", { "session.json": "{}" }, /^session\.json: "schemaVersion" must be 1 or 2/],
    ["a session.md that is not UTF-8", { "session.md": Buffer.from([0x23, 0x20, 0xff, 0xfe]) }, /^session\.md is not valid UTF-8$/],
  ] as const)("refuses %s", async (_, overrides, message) => {
    const { files, body } = recording(SESSION_ID, overrides);
    const result = await storeSession({ base, id: SESSION_ID, files, body });
    expect(result).toMatchObject({ status: 400, error: "bad-request", message: expect.stringMatching(message) });
    expect(existsSync(base)).toBe(false);
  });

  it("refuses a body whose length is not the files' total", async () => {
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body: body.subarray(1) });
    expect(result).toMatchObject({ status: 400, error: "bad-request" });
  });

  it("retries a rename Windows refuses while a scanner holds the new files", async () => {
    const spy = renameFailing(errno("EPERM", "EPERM: operation not permitted, rename"), errno("EBUSY", "EBUSY: resource busy or locked"));
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body, fs: spy.fs, platform: "win32" });
    expect(result).toMatchObject({ status: 201 });
    expect(spy.calls).toBe(3);
    expect(readdirSync(base)).toEqual([SESSION_ID]);
  });

  it("does not retry that rename elsewhere, where EPERM does not go away, and removes its staging folder", async () => {
    const spy = renameFailing(errno("EPERM", "EPERM: operation not permitted, rename"));
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body, fs: spy.fs, platform: "linux" });
    expect(result).toEqual({ status: 500, error: "write-failed", message: "EPERM: operation not permitted" });
    expect(spy.calls).toBe(1);
    expect(readdirSync(base)).toEqual([]);
  });

  it("answers 409 when the target appears while the rename is refused, and leaves it alone", async () => {
    // Windows answers EPERM for a rename onto an existing folder, the same as for a locked one.
    const spy = renameFailing(() => {
      mkdirSync(join(base, SESSION_ID));
      writeFileSync(join(base, SESSION_ID, "session.json"), "theirs");
      return errno("EPERM", "EPERM: operation not permitted, rename");
    });
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body, fs: spy.fs, platform: "win32" });
    expect(result).toEqual({ status: 409, error: "exists", message: `a session folder named ${SESSION_ID} already exists` });
    expect(readdirSync(base)).toEqual([SESSION_ID]);
    expect(readFileSync(join(base, SESSION_ID, "session.json"), "utf8")).toBe("theirs");
  });

  it("never replaces an existing folder, not even an empty one (a POSIX rename would)", async () => {
    mkdirSync(join(base, SESSION_ID), { recursive: true });
    const { files, body } = recording();
    expect(await storeSession({ base, id: SESSION_ID, files, body })).toMatchObject({ status: 409, error: "exists" });
    expect(readdirSync(base)).toEqual([SESSION_ID]);
    expect(readdirSync(join(base, SESSION_ID))).toEqual([]);
  });

  it("answers 500 with the error code, but no path, when a write fails, and cleans up", async () => {
    let writes = 0;
    const fs: StoreFs = {
      ...fsPromises,
      writeFile: async (...args: Parameters<typeof fsPromises.writeFile>) => {
        if (++writes === 2) throw errno("ENOSPC", `ENOSPC: no space left on device, write '${join(homedir(), "x")}'`);
        return fsPromises.writeFile(...args);
      },
    };
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body, fs });
    expect(result).toEqual({ status: 500, error: "write-failed", message: "ENOSPC: no space left on device" });
    expect(readdirSync(base)).toEqual([]);
  });

  it("discards the staging folder when the extension stopped waiting (H8)", async () => {
    const { files, body } = recording();
    const result = await storeSession({ base, id: SESSION_ID, files, body, clientGone: () => true });
    expect(result).toEqual({ status: 500, error: "write-failed", message: "the extension stopped waiting" });
    expect(readdirSync(base)).toEqual([]);
  });

  it("refuses an id that is not one folder directly in base", async () => {
    const { files, body } = recording("..");
    expect(await storeSession({ base, id: "..", files, body })).toMatchObject({ status: 400, error: "bad-request" });
    expect(existsSync(base)).toBe(false);
  });

  it("sessionFolderExists sees a folder or a file by that name", async () => {
    mkdirSync(base);
    expect(await sessionFolderExists(base, SESSION_ID)).toBe(false);
    writeFileSync(join(base, SESSION_ID), "");
    expect(await sessionFolderExists(base, SESSION_ID)).toBe(true);
  });
});

describe("sweepStaging", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-handoff-sweep-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("removes staging folders over an hour old, and nothing else", async () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    for (const name of [`${STAGING_PREFIX}old`, `${STAGING_PREFIX}fresh`, "2026-01-01_09-00-00"]) {
      mkdirSync(join(base, name));
      writeFileSync(join(base, name, "session.json"), "{}");
    }
    utimesSync(join(base, `${STAGING_PREFIX}old`), twoHoursAgo, twoHoursAgo);
    utimesSync(join(base, "2026-01-01_09-00-00"), twoHoursAgo, twoHoursAgo);

    await sweepStaging(base, now);
    expect(readdirSync(base).sort()).toEqual([`${STAGING_PREFIX}fresh`, "2026-01-01_09-00-00"]);
  });

  it("never throws, even when the sessions folder does not exist", async () => {
    await expect(sweepStaging(join(base, "missing"))).resolves.toBeUndefined();
  });
});

describe("displayPath", () => {
  it.each([
    ["C:\\Users\\me\\Downloads\\pointcast\\x", "C:\\Users\\me", "~\\Downloads\\pointcast\\x"],
    ["c:\\users\\ME\\Downloads", "C:\\Users\\me", "~\\Downloads"],
    ["C:\\Users\\me", "C:\\Users\\me", "~"],
    // Outside the home folder: only the last two segments, never a user name higher up (D8).
    ["C:\\Users\\meme\\x", "C:\\Users\\me", "…\\meme\\x"],
    ["D:\\sessions\\x", "C:\\Users\\me", "…\\sessions\\x"],
    ["D:\\Users\\me\\Downloads\\pointcast\\2026-09-28_10-15-00", "C:\\Users\\me", "…\\pointcast\\2026-09-28_10-15-00"],
    ["D:\\work\\me\\pointcast", "C:\\Users\\me", "…\\me\\pointcast"],
    ["\\\\server\\share\\me\\pointcast\\x", "C:\\Users\\me", "…\\pointcast\\x"],
    ["D:\\", "C:\\Users\\me", "…"],
    ["C:\\Users\\me\\..hidden\\x", "C:\\Users\\me", "~\\..hidden\\x"],
    ["/home/me/Downloads/pointcast/x", "/home/me", "~/Downloads/pointcast/x"],
    ["/home/me", "/home/me", "~"],
    ["/home/meme/x", "/home/me", "…/meme/x"],
    ["/srv/pointcast", "/home/me", "…/srv/pointcast"],
    ["/mnt/data/me/Downloads/pointcast/x", "/home/me", "…/pointcast/x"],
  ])("%s (home %s) → %s", (absolute, home, expected) => {
    expect(displayPath(absolute, home)).toBe(expected);
  });
});
