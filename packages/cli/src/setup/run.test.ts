import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DoctorReport } from "../doctor/doctor";
import type { CommandStep, SetupPlan } from "./plan";
import { resolveMode, runSetup, type SetupMode, type SetupRunDependencies } from "./run";
import { findOnPath, spawnSpec } from "./system";

/** No agent is ever run here: the runner, the prompt, the writes and doctor are fakes. */

const DOCTOR_OK: DoctorReport = { version: "0.6.0", ok: true, checks: [{ id: "node", status: "ok", summary: "Node.js 22.14.0" }] };

function plan(): SetupPlan {
  return {
    version: "0.6.0",
    repo: "/work/app",
    agents: [
      {
        id: "claude-code",
        name: "Claude Code",
        state: "missing",
        detail: "found; pointcast is not set up",
        action: {
          kind: "run",
          steps: [
            { command: "claude", args: ["plugin", "marketplace", "add", "Hugelidus/pointcast"], mayFail: true },
            { command: "claude", args: ["plugin", "install", "pointcast@pointcast"] },
          ],
        },
      },
      { id: "codex", name: "Codex", state: "configured", detail: "found; the pointcast plugin is installed" },
      { id: "gemini", name: "Gemini CLI", state: "not-found", detail: "not found" },
      {
        id: "cursor",
        name: "Cursor",
        state: "missing",
        detail: "found; pointcast is not set up",
        action: { kind: "write", file: "/work/app/.cursor/mcp.json", content: '{\n  "mcpServers": {}\n}\n' },
      },
    ],
    stack: [{ id: "django", summary: "Django: add pointcast-django.", steps: ["pip install …"] }],
    extension: ["Load unpacked."],
  };
}

interface Fakes extends SetupRunDependencies {
  ran: string[];
  written: string[];
  asked: string[];
  printed: string[];
  doctorRuns: number;
}

function fakes(options: { answers?: boolean[]; exitCodes?: Record<string, number> } = {}): Fakes {
  const answers = [...(options.answers ?? [])];
  const f: Fakes = {
    ran: [],
    written: [],
    asked: [],
    printed: [],
    doctorRuns: 0,
    run: async (step: CommandStep) => {
      const line = [step.command, ...step.args].join(" ");
      f.ran.push(line);
      const code = options.exitCodes?.[line] ?? 0;
      return { code, output: code === 0 ? "" : "already added" };
    },
    confirm: async (question) => {
      f.asked.push(question);
      return answers.shift() ?? false;
    },
    writeFile: async (file) => {
      f.written.push(file);
    },
    doctor: async () => {
      f.doctorRuns++;
      return DOCTOR_OK;
    },
    print: (text) => {
      f.printed.push(text);
    },
  };
  return f;
}

const run = (mode: SetupMode, deps: SetupRunDependencies, json = false, modeReason?: string) =>
  runSetup(plan(), { mode, json, ...(modeReason !== undefined ? { modeReason } : {}) }, deps);

describe("resolveMode", () => {
  const base = { dryRun: false, yes: false, json: false, interactive: true };
  it("asks on a terminal, and is a dry run whenever nobody can answer", () => {
    expect(resolveMode(base)).toEqual({ mode: "ask" });
    expect(resolveMode({ ...base, yes: true })).toEqual({ mode: "yes" });
    expect(resolveMode({ ...base, dryRun: true, yes: true }).mode).toBe("dry-run");
    expect(resolveMode({ ...base, json: true })).toEqual({ mode: "dry-run", reason: "--json without --yes" });
    expect(resolveMode({ ...base, json: true, yes: true })).toEqual({ mode: "yes" });
    expect(resolveMode({ ...base, interactive: false }).mode).toBe("dry-run");
    expect(resolveMode({ ...base, interactive: false }).reason).toContain("no terminal");
    expect(resolveMode({ ...base, interactive: false, yes: true })).toEqual({ mode: "yes" });
  });
});

describe("runSetup", () => {
  it("a dry run changes nothing, asks nothing, skips doctor and shows every command and file", async () => {
    const f = fakes();
    const report = await run("dry-run", f, false, "--dry-run");
    expect([f.ran, f.written, f.asked, f.doctorRuns]).toEqual([[], [], [], 0]);
    const text = f.printed.join("\n");
    expect(text).toContain("Dry run (--dry-run): nothing is changed.");
    expect(text).toContain("would run:\n      claude plugin marketplace add Hugelidus/pointcast\n      claude plugin install pointcast@pointcast");
    expect(text).toContain("would write /work/app/.cursor/mcp.json:");
    expect(text).toContain("pointcast doctor (not run in a dry run)");
    expect(text).toContain("Summary: would set up: Claude Code, Cursor; already set up: Codex.");
    expect(report.agents.map((a) => a.outcome)).toEqual(["planned", undefined, undefined, "planned"]);
    expect(report).toMatchObject({ ok: true, mode: "dry-run" });
    expect(report.doctor).toBeUndefined();
  });

  it("asks before each action and does only what was accepted", async () => {
    const f = fakes({ answers: [false, true] });
    const report = await run("ask", f);
    expect(f.asked).toEqual(["  Set up pointcast in Claude Code?", "  Set up pointcast in Cursor?"]);
    expect(f.ran).toEqual([]);
    expect(f.written).toEqual(["/work/app/.cursor/mcp.json"]);
    expect(report.agents.map((a) => a.outcome)).toEqual(["declined", undefined, undefined, "done"]);
    expect(f.doctorRuns).toBe(1);
    const text = f.printed.join("\n");
    expect(text).toContain("pointcast doctor (0.6.0)");
    expect(text).toContain("Summary: set up: Cursor; declined: Claude Code; already set up: Codex.");
    expect(text).toContain("Restart Cursor so it starts pointcast's MCP server.");
  });

  it("--yes does every action without asking", async () => {
    const f = fakes();
    const report = await run("yes", f);
    expect(f.asked).toEqual([]);
    expect(f.ran).toEqual(["claude plugin marketplace add Hugelidus/pointcast", "claude plugin install pointcast@pointcast"]);
    expect(f.written).toEqual(["/work/app/.cursor/mcp.json"]);
    expect(report.ok).toBe(true);
  });

  it("tolerates a failed marketplace step when the install succeeds, and fails when the install fails", async () => {
    const tolerated = fakes({ exitCodes: { "claude plugin marketplace add Hugelidus/pointcast": 1 } });
    const ok = await run("yes", tolerated);
    expect(tolerated.ran).toHaveLength(2);
    expect(ok.agents[0]).toMatchObject({ outcome: "done", note: expect.stringContaining("ignored") });
    expect(ok.ok).toBe(true);

    const failing = fakes({ exitCodes: { "claude plugin install pointcast@pointcast": 2 } });
    const failed = await run("yes", failing);
    expect(failed.agents[0]).toMatchObject({ outcome: "failed", note: expect.stringContaining("exited with 2") });
    expect(failed.ok).toBe(false);
    expect(failing.printed.join("\n")).toContain("FAILED: Claude Code");
  });

  it("is not ok when doctor finds a problem that stops pointcast", async () => {
    const f = fakes();
    f.doctor = async () => ({ ...DOCTOR_OK, ok: false });
    expect((await run("yes", f)).ok).toBe(false);
  });

  it("--json prints nothing itself, captures command output and reports the plan and outcomes", async () => {
    const f = fakes();
    const captured: boolean[] = [];
    const inner = f.run;
    f.run = async (step, options) => {
      captured.push(options.capture);
      return inner(step, options);
    };
    const report = await run("yes", f, true);
    expect(f.printed).toEqual([]);
    expect(captured).toEqual([true, true]);
    expect(report.agents[0]?.action).toEqual({
      kind: "run",
      commands: ["claude plugin marketplace add Hugelidus/pointcast", "claude plugin install pointcast@pointcast"],
    });
    expect(report.doctor).toEqual(DOCTOR_OK);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("system", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pointcast-path-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds .cmd shims on Windows through PATHEXT, and never an extensionless script there", () => {
    writeFileSync(path.join(dir, "cursor"), "#!/bin/sh\n");
    expect(findOnPath("cursor", { PATH: dir, PATHEXT: ".EXE;.CMD" }, "win32")).toBeUndefined();
    writeFileSync(path.join(dir, "cursor.cmd"), "@echo off\n");
    expect(findOnPath("cursor", { Path: dir, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(path.join(dir, "cursor.cmd"));
    expect(findOnPath("claude", { PATH: dir }, "win32")).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("finds executables elsewhere by name and permission", () => {
    const file = path.join(dir, "gemini");
    writeFileSync(file, "#!/bin/sh\n");
    expect(findOnPath("gemini", { PATH: dir }, "linux")).toBeUndefined();
    chmodSync(file, 0o755);
    expect(findOnPath("gemini", { PATH: dir }, "linux")).toBe(file);
  });

  it("runs through the shell on Windows only, with fixed tokens", () => {
    const step = { command: "claude", args: ["plugin", "install", "pointcast@pointcast"] };
    expect(spawnSpec(step, "win32")).toEqual({ file: "claude plugin install pointcast@pointcast", args: [], shell: true });
    expect(spawnSpec(step, "linux")).toEqual({ file: "claude", args: step.args, shell: false });
    expect(() => spawnSpec({ command: "claude", args: ["a & calc"] }, "win32")).toThrow(/refusing/);
    expect(() => spawnSpec({ command: "gemini", args: ["https://github.com/Hugelidus/pointcast"] }, "win32")).not.toThrow();
  });

  it("does not take a folder for an executable", () => {
    mkdirSync(path.join(dir, "codex.cmd"));
    expect(findOnPath("codex", { PATH: dir, PATHEXT: ".CMD" }, "win32")).toBeUndefined();
  });
});
