import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSessionDir } from "./discover";
import { downloadsDir, expandWindowsVariables, parseRegistryValue } from "./downloads-dir";

const setTime = (dir: string, iso: string) => utimesSync(dir, new Date(iso), new Date(iso));

/** A session folder: `listSessionDirs` only counts one that has a session.json (its content is
 * never read for that check). */
function makeSessionDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), "{}");
}

describe("resolveSessionDir", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-cli-discover-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns the explicit directory untouched, ignoring --dir/POINTCAST_DIR", async () => {
    const explicit = join(base, "somewhere-else");
    expect(await resolveSessionDir({ explicit, dirFlag: base })).toEqual({ dir: explicit, reason: "given as argument" });
  });

  it("picks the latest session by the recording time in its name, not by folder mtime", async () => {
    const sessionA = join(base, "2026-01-01_09-00-00");
    const sessionB = join(base, "2026-01-02_09-00-00");
    makeSessionDir(sessionA);
    makeSessionDir(sessionB);
    // `pointcast process <A>` writes words.json and session.md into A, so A is now the most
    // recently modified folder. A plain `pointcast process` must still pick B.
    setTime(sessionB, "2026-01-02T09:05:00Z");
    setTime(sessionA, "2026-01-03T12:00:00Z");

    const resolved = await resolveSessionDir({ dirFlag: base });
    expect(resolved.dir).toBe(sessionB);
    expect(resolved.reason).toMatch(/recording time in its name/);
  });

  it("orders two sessions started in the same second by their suffix", async () => {
    makeSessionDir(join(base, "2026-01-01_09-00-00"));
    makeSessionDir(join(base, "2026-01-01_09-00-00-2"));
    makeSessionDir(join(base, "2025-12-31_23-59-59"));
    expect((await resolveSessionDir({ dirFlag: base })).dir).toBe(join(base, "2026-01-01_09-00-00-2"));
  });

  it("falls back to mtime for folders whose name is not a session id", async () => {
    const renamed = join(base, "export-bug");
    const session = join(base, "2020-01-01_00-00-00");
    makeSessionDir(renamed);
    makeSessionDir(session);
    setTime(renamed, "2025-06-01T00:00:00Z");

    const resolved = await resolveSessionDir({ dirFlag: base });
    expect(resolved.dir).toBe(renamed);
    expect(resolved.reason).toMatch(/most recently modified/);
  });

  it("ignores files, only considers directories", async () => {
    writeFileSync(join(base, "not-a-session.txt"), "x");
    const onlyDir = join(base, "2026-01-01_00-00-00");
    makeSessionDir(onlyDir);
    expect((await resolveSessionDir({ dirFlag: base })).dir).toBe(onlyDir);
  });

  it("throws a friendly error, with the --dir hint, when the base directory does not exist", async () => {
    await expect(resolveSessionDir({ dirFlag: join(base, "does-not-exist") })).rejects.toThrowError(
      /does not exist.*--dir \/ POINTCAST_DIR.*chrome:\/\/settings\/downloads/,
    );
  });

  it("throws a friendly error when the base directory has no session folders", async () => {
    await expect(resolveSessionDir({ dirFlag: base })).rejects.toThrowError(/No session folders/);
  });

  it("throws a friendly error mentioning the Chrome setting when folders exist but none has a session.json", async () => {
    mkdirSync(join(base, "2026-01-01_09-00-00"));
    mkdirSync(join(base, "2026-01-02_09-00-00"));
    await expect(resolveSessionDir({ dirFlag: base })).rejects.toThrowError(
      /has a session\.json.*Ask where to save each file before downloading.*chrome:\/\/settings\/downloads/,
    );
  });

  it("picks the newest folder with a session.json, and notes the newer empty ones it skipped", async () => {
    makeSessionDir(join(base, "2026-01-01_09-00-00"));
    // Chrome's "ask where to save" dialog left these two empty: no session.json ever arrived.
    mkdirSync(join(base, "2026-01-02_09-00-00"));
    mkdirSync(join(base, "2026-01-03_09-00-00"));

    const resolved = await resolveSessionDir({ dirFlag: base });
    expect(resolved.dir).toBe(join(base, "2026-01-01_09-00-00"));
    expect(resolved.reason).toMatch(
      /Skipped 2 newer session folders with no session\.json \(2026-01-03_09-00-00, 2026-01-02_09-00-00\).*Ask where to save each file before downloading/,
    );
  });

  it("falls back through dirFlag, then envDir, then <Downloads>/pointcast", async () => {
    const downloads = join(base, "Downloads");
    const only = join(downloads, "pointcast", "2026-01-01_00-00-00");
    makeSessionDir(only);
    const env = join(base, "env");
    makeSessionDir(join(env, "2026-02-02_00-00-00"));

    expect((await resolveSessionDir({ downloadsDir: downloads })).dir).toBe(only);
    expect((await resolveSessionDir({ downloadsDir: downloads, envDir: env })).dir).toBe(join(env, "2026-02-02_00-00-00"));
  });
});

describe("downloadsDir", () => {
  const REG_OUTPUT = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
    "    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    D:\\Users\\Me\\OneDrive\\Descargas",
    "",
  ].join("\r\n");

  it("uses the relocated Downloads known folder on Windows", () => {
    expect(downloadsDir({ platform: "win32", env: {}, homeDir: "C:\\Users\\me", queryRegistry: () => REG_OUTPUT })).toBe(
      "D:\\Users\\Me\\OneDrive\\Descargas",
    );
  });

  it("falls back to <home>/Downloads when the registry has no answer, or on other systems", () => {
    expect(downloadsDir({ platform: "win32", env: {}, homeDir: "/home/me", queryRegistry: () => undefined })).toBe(
      join("/home/me", "Downloads"),
    );
    expect(downloadsDir({ platform: "linux", env: {}, homeDir: "/home/me", queryRegistry: () => REG_OUTPUT })).toBe(
      join("/home/me", "Downloads"),
    );
  });

  it("parses reg output and expands %VARIABLES% case-insensitively", () => {
    expect(parseRegistryValue(REG_OUTPUT, "{374de290-123f-4565-9164-39c4925e467b}")).toBe("D:\\Users\\Me\\OneDrive\\Descargas");
    expect(expandWindowsVariables("%USERPROFILE%\\Downloads", { UserProfile: "C:\\Users\\me" })).toBe("C:\\Users\\me\\Downloads");
    expect(downloadsDir({
      platform: "win32",
      env: {},
      homeDir: "/fallback",
      queryRegistry: () => "    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    %UNKNOWN%\\Downloads",
    })).toBe(join("/fallback", "Downloads"));
  });
});
