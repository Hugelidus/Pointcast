import path from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../errors";
import { compareVersions, formatDoctorReport, runDoctor, type DoctorDependencies, type DoctorOptions } from "./doctor";

const DOWNLOADS = path.join("/home/ana/Descargas");
const BASE = path.join(DOWNLOADS, "pointcast");

/** Everything works: a current Node, two sessions, a receiving server of the same version. */
function deps(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    version: "0.2.1",
    nodeVersion: "22.14.0",
    platform: "win32",
    downloadsDir: () => DOWNLOADS,
    isDirectory: async () => true,
    listSessions: async (base) => ({
      dirs: [path.join(base, "2026-09-28_10-15-00"), path.join(base, "2026-09-27_09-00-00")],
      skippedNewer: [],
    }),
    probeReceiver: async () => ({ kind: "pointcast", version: "0.2.1", protocol: 1 }),
    transformersInstalled: () => true,
    onPath: () => false,
    latestNpmVersion: async () => {
      throw new Error("the network must not be used without --online");
    },
    ...overrides,
  };
}

const OFFLINE: DoctorOptions = { online: false };

function check(report: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} check`);
  return found;
}

describe("runDoctor", () => {
  it("reports every check ok on a working setup, without the network", async () => {
    const report = await runDoctor(OFFLINE, deps());
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ["node", "ok"],
      ["sessions", "ok"],
      ["receiver", "ok"],
      ["transcription", "ok"],
      ["version", "ok"],
    ]);
    expect(check(report, "sessions").summary).toBe(
      `Sessions folder (the Downloads folder): ${BASE}: 2 sessions, newest 2026-09-28_10-15-00`,
    );
    expect(check(report, "receiver").summary).toContain("pointcast 0.2.1 is receiving recordings on 127.0.0.1:20547");
    expect(check(report, "version").summary).toContain("--online");
    expect(formatDoctorReport(report)).toMatch(/Everything works\.$/);
  });

  it("fails on a Node.js older than 22.12", async () => {
    for (const nodeVersion of ["22.11.0", "20.18.1"]) {
      const report = await runDoctor(OFFLINE, deps({ nodeVersion }));
      expect(report.ok).toBe(false);
      expect(check(report, "node")).toMatchObject({ status: "fail", fix: expect.stringContaining("nodejs.org") });
    }
    expect((await runDoctor(OFFLINE, deps({ nodeVersion: "22.12.0" }))).ok).toBe(true);
    expect((await runDoctor(OFFLINE, deps({ nodeVersion: "24.0.0" }))).ok).toBe(true);
  });

  it("reads --dir first, then POINTCAST_DIR, then the Downloads folder", async () => {
    const seen: string[] = [];
    const recording = deps({
      listSessions: async (base) => {
        seen.push(base);
        return { dirs: [path.join(base, "s")], skippedNewer: [] };
      },
      downloadsDir: () => {
        seen.push("asked Downloads");
        return DOWNLOADS;
      },
    });
    await runDoctor({ online: false, dirFlag: "/flag", envDir: "/env" }, recording);
    await runDoctor({ online: false, envDir: "/env" }, recording);
    await runDoctor(OFFLINE, recording);
    expect(seen).toEqual(["/flag", "/env", "asked Downloads", BASE]);
  });

  it("fails when --dir or POINTCAST_DIR does not exist, but only warns for a Downloads folder with no recordings yet", async () => {
    const missing = deps({ isDirectory: async () => false });
    const flag = await runDoctor({ online: false, dirFlag: "/typo" }, missing);
    expect(flag.ok).toBe(false);
    expect(check(flag, "sessions")).toMatchObject({ status: "fail", summary: expect.stringContaining("(--dir): /typo does not exist") });
    const env = await runDoctor({ online: false, envDir: "/typo" }, missing);
    expect(check(env, "sessions").fix).toContain("POINTCAST_DIR");

    const fresh = await runDoctor(OFFLINE, missing);
    expect(fresh.ok).toBe(true);
    expect(check(fresh, "sessions")).toMatchObject({ status: "warn", fix: expect.stringContaining("POINTCAST_DIR") });
  });

  it("passes on listSessionDirs' advice when the folder holds no session", async () => {
    const report = await runDoctor(
      OFFLINE,
      deps({
        listSessions: async () => {
          throw new CliError("No session folders found in the base. Pass a session directory, or point --dir ...");
        },
      }),
    );
    expect(check(report, "sessions")).toMatchObject({ status: "warn", fix: expect.stringContaining("No session folders found") });
    expect(report.ok).toBe(true);
  });

  it("warns about newer folders without session.json (Chrome's Ask where to save)", async () => {
    const report = await runDoctor(
      OFFLINE,
      deps({ listSessions: async (base) => ({ dirs: [path.join(base, "2026-09-27_09-00-00")], skippedNewer: ["2026-09-28_10-15-00"] }) }),
    );
    expect(check(report, "sessions")).toMatchObject({
      status: "warn",
      summary: expect.stringContaining("1 session, newest 2026-09-27_09-00-00; 1 newer folder has no session.json (2026-09-28_10-15-00)"),
      fix: expect.stringContaining("Ask where to save"),
    });
  });

  it("says who answers on the handoff port", async () => {
    const other = await runDoctor(OFFLINE, deps({ probeReceiver: async () => ({ kind: "other", detail: "it answered HTTP 404, not a pointcast hello" }) }));
    expect(check(other, "receiver")).toMatchObject({ status: "warn", summary: expect.stringContaining("another program holds 127.0.0.1:20547") });
    expect(check(other, "receiver").fix).toMatch(/netstat|lsof/);

    const nobody = await runDoctor(OFFLINE, deps({ probeReceiver: async () => ({ kind: "nobody" }) }));
    expect(check(nobody, "receiver")).toMatchObject({ status: "warn", summary: expect.stringContaining("nobody is receiving") });
    expect(nobody.ok).toBe(true);

    const older = await runDoctor(OFFLINE, deps({ probeReceiver: async () => ({ kind: "pointcast", version: "0.2.0", protocol: 1 }) }));
    expect(check(older, "receiver")).toMatchObject({ status: "ok", summary: expect.stringContaining("pointcast 0.2.0 is receiving recordings on 127.0.0.1:20547 (this CLI is 0.2.1)") });
    // Several agent sessions share the folder, so it works; an older one is a session from before the update.
    expect(check(older, "receiver").note).toMatch(/same sessions folder.*older.*before you updated.*close the agent sessions started before the update/s);
    expect(formatDoctorReport(older)).toContain("\n      note: Each agent session starts its own pointcast MCP server");

    const same = await runDoctor(OFFLINE, deps());
    expect(check(same, "receiver").note).toMatch(/same sessions folder/);
    expect(check(same, "receiver").note).not.toContain("That one is older");

    const newProtocol = await runDoctor(OFFLINE, deps({ probeReceiver: async () => ({ kind: "pointcast", version: "0.9.0", protocol: 2 }) }));
    expect(check(newProtocol, "receiver")).toMatchObject({ status: "warn", summary: expect.stringContaining("protocol 2") });
  });

  it("warns when transformers.js is missing, with the install command", async () => {
    const report = await runDoctor(OFFLINE, deps({ transformersInstalled: () => false }));
    expect(check(report, "transcription")).toMatchObject({
      status: "warn",
      fix: expect.stringContaining("npm install -g pointcast @huggingface/transformers"),
    });
    expect(report.ok).toBe(true);
  });

  it("checks for a clipboard tool on Linux only", async () => {
    const windows = await runDoctor(OFFLINE, deps());
    expect(windows.checks.some((c) => c.id === "clipboard")).toBe(false);

    const none = await runDoctor(OFFLINE, deps({ platform: "linux" }));
    expect(check(none, "clipboard")).toMatchObject({ status: "warn", summary: expect.stringContaining("wl-copy, xclip, xsel") });

    const xclip = await runDoctor(OFFLINE, deps({ platform: "linux", onPath: (tool) => tool === "xclip" }));
    expect(check(xclip, "clipboard")).toMatchObject({ status: "ok", summary: "Clipboard: xclip" });
  });

  it("compares with npm only with --online", async () => {
    const latest = (version: string | undefined) => deps({ latestNpmVersion: async () => version });
    expect(check(await runDoctor({ online: true }, latest("0.2.1")), "version")).toMatchObject({ status: "ok", summary: "pointcast 0.2.1 (latest on npm: 0.2.1)" });
    expect(check(await runDoctor({ online: true }, latest("0.3.0")), "version")).toMatchObject({
      status: "warn",
      fix: expect.stringContaining("pointcast@latest"),
    });
    expect(check(await runDoctor({ online: true }, latest(undefined)), "version")).toMatchObject({ status: "warn", summary: expect.stringContaining("could not ask npm") });
  });
});

describe("formatDoctorReport", () => {
  it("prints one line per check, the fix under it, and a verdict", async () => {
    const text = formatDoctorReport(
      await runDoctor(OFFLINE, deps({ nodeVersion: "20.0.0", probeReceiver: async () => ({ kind: "nobody" }) })),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("pointcast doctor (0.2.1)");
    expect(lines).toContain("FAIL  Node.js 20.0.0 is too old: pointcast needs 22.12 or newer");
    expect(lines).toContain("warn  MCP server: nobody is receiving recordings on 127.0.0.1:20547");
    expect(lines.filter((line) => line.startsWith("      fix: "))).toHaveLength(2);
    expect(lines.at(-1)).toBe("1 problem stops pointcast from working: fix it first.");
  });

  it("says pointcast works when only optional parts are missing", async () => {
    const text = formatDoctorReport(await runDoctor(OFFLINE, deps({ transformersInstalled: () => false })));
    expect(text.split("\n").at(-1)).toBe("pointcast works; 1 optional part is not set up.");
  });
});

describe("compareVersions", () => {
  it("orders versions numerically", () => {
    expect(compareVersions("22.12.0", "22.9.9")).toBe(1);
    expect(compareVersions("v22.12", "22.12.0")).toBe(0);
    expect(compareVersions("0.2.1", "0.10.0")).toBe(-1);
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(0);
  });
});
