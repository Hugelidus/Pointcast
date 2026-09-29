import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTRUCTION_LINES } from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSession, listSessions, resolveSessionDirById } from "./sessions";

const FIXTURE_WITH_WORDS = join(__dirname, "../../../../dev/fixtures/sessions/e2e-es-v2");

function minimalSession(id: string) {
  return JSON.stringify({
    schemaVersion: 2,
    id,
    startedAt: "2026-01-01T09:00:00.000Z",
    t0: 0,
    durationMs: 0,
    recorder: { extensionVersion: "0.0.0", userAgent: "test" },
    events: [],
  });
}

describe("mcp sessions tools", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-mcp-sessions-"));
    mkdirSync(join(base, "2026-01-01_09-00-00"));
    writeFileSync(join(base, "2026-01-01_09-00-00", "session.json"), minimalSession("2026-01-01_09-00-00"));
    cpSync(FIXTURE_WITH_WORDS, join(base, "2026-01-02_09-00-00"), { recursive: true });
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("listSessions", () => {
    it("lists sessions newest first with id, date, duration and element count", async () => {
      const sessions = await listSessions({ dirFlag: base });
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({ id: "2026-01-02_09-00-00", elements: 10, durationMs: 11880, matchesProject: "unknown" });
      expect(sessions[1]).toMatchObject({ elements: 0, rendered: false });
    });

    it("skips a folder with no valid session.json instead of failing the whole list", async () => {
      writeFileSync(join(base, "2026-01-01_09-00-00", "session.json"), "not json");
      const sessions = await listSessions({ dirFlag: base });
      expect(sessions).toHaveLength(1);
    });

    it("respects the limit", async () => {
      expect(await listSessions({ dirFlag: base }, 1)).toHaveLength(1);
    });

    it("throws the same friendly error as resolveSessionDir when the base does not exist", async () => {
      await expect(listSessions({ dirFlag: join(base, "nope") })).rejects.toThrowError(/does not exist/);
    });
  });

  describe("resolveSessionDirById", () => {
    it("resolves 'latest' to the newest session dir", async () => {
      expect(await resolveSessionDirById({ dirFlag: base }, "latest")).toEqual({
        dir: join(base, "2026-01-02_09-00-00"),
        skippedNewer: [],
      });
    });

    it("notes newer folders with no session.json that 'latest' had to skip", async () => {
      mkdirSync(join(base, "2026-01-03_09-00-00"));
      expect(await resolveSessionDirById({ dirFlag: base }, "latest")).toEqual({
        dir: join(base, "2026-01-02_09-00-00"),
        skippedNewer: ["2026-01-03_09-00-00"],
      });
    });

    it("names the newest recordings, with their preview, for an id that is not there", async () => {
      const error = await resolveSessionDirById({ dirFlag: base }, "2025-12-31_23-59-59").catch((e: Error) => e);
      expect((error as Error).message).toBe(
        [
          `No recording "2025-12-31_23-59-59" in ${base}. The newest 2 are:`,
          '- 2026-01-02_09-00-00: "Esto me gustaría que estuviera filtrado por cantidad."',
          "- 2026-01-01_09-00-00",
          'Pass one of these ids, "latest-here" or "latest", or call list_sessions to see them all.',
        ].join("\n"),
      );
      mkdirSync(join(base, "2026-01-05_09-00-00"));
      await expect(resolveSessionDirById({ dirFlag: base }, "2026-01-05_09-00-00")).rejects.toThrow(
        'Recording "2026-01-05_09-00-00" has no session.json',
      );
    });

    it("joins an explicit id onto the base when its session.json is there", async () => {
      expect(await resolveSessionDirById({ dirFlag: base }, "2026-01-01_09-00-00")).toEqual({
        dir: join(base, "2026-01-01_09-00-00"),
        skippedNewer: [],
      });
    });
  });

  describe("resolveSessionDirById rejects ids that leave the sessions folder", () => {
    it.each(["..", ".", "", "../other", "a/../../b", "..\\other", "C:\\Windows", "/etc", ".incoming-x", ".hidden"])("%j", async (id) => {
      await expect(resolveSessionDirById({ dirFlag: base }, id)).rejects.toThrow("is not a session id");
    });
  });

  describe("getSession", () => {
    it("renders session.md from session.json + words.json when it is missing on disk", async () => {
      const dir = join(base, "2026-01-02_09-00-00");
      const result = await getSession(dir);
      expect(result.rendered).toBe(true);
      expect(result.markdown).toContain("Quantity");
      expect(result.chars).toBeGreaterThan(0);
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("caches the rendered session.md so a second call reads it back instead of re-rendering", async () => {
      const dir = join(base, "2026-01-02_09-00-00");
      const first = await getSession(dir);
      const second = await getSession(dir);
      expect(second.rendered).toBe(false);
      expect(second.markdown).toBe(first.markdown);
    });

    it("renders a style asked for over the recording's, without caching it as session.md", async () => {
      const dir = join(base, "2026-01-02_09-00-00");
      const saved = await getSession(dir);
      expect(saved.markdown).toContain(INSTRUCTION_LINES.intent);
      const precise = await getSession(dir, { style: "precise" });
      expect(precise.rendered).toBe(true);
      expect(precise.markdown).toContain(INSTRUCTION_LINES.precise);
      expect(precise.markdown).not.toContain(INSTRUCTION_LINES.intent);
      expect(precise.note).toBeUndefined();
      expect(readFileSync(join(dir, "session.md"), "utf8")).toBe(saved.markdown);
    });

    it("says so when a style cannot be applied: session.md on disk and no words.json", async () => {
      const dir = join(base, "2026-01-02_09-00-00");
      await getSession(dir);
      rmSync(join(dir, "words.json"));
      const result = await getSession(dir, { style: "precise" });
      expect(result.markdown).toContain(INSTRUCTION_LINES.intent);
      expect(result.note).toMatch(/no words\.json to render it in the "precise" style/);
    });

    it("fails with a clear message when there is neither session.md nor words.json", async () => {
      const dir = join(base, "2026-01-01_09-00-00");
      await expect(getSession(dir)).rejects.toThrowError(/pointcast process/);
    });
  });
});
