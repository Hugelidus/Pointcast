import { describe, expect, it } from "vitest";
import { parseCommandLine } from "./args";
import { CliError } from "./errors";

describe("parseCommandLine", () => {
  it("parses process with every option", () => {
    expect(
      parseCommandLine(["process", "some/dir", "--engine", "openai", "--model", "whisper-1", "--language", "es", "--threads", "4", "--force", "--stdout", "--dir", "base"]),
    ).toEqual({
      command: "process",
      target: "some/dir",
      engine: "openai",
      model: "whisper-1",
      language: "es",
      threads: 4,
      force: true,
      toStdout: true,
      dir: "base",
    });
  });

  it("defaults to the local engine and no target for process", () => {
    expect(parseCommandLine(["process"])).toEqual({ command: "process", engine: "local", force: false, toStdout: false });
  });

  it("drops the '--' pnpm inserts, so options after it are still options", () => {
    expect(parseCommandLine(["--", "transcribe", "a.wav", "--language", "en"])).toEqual({
      command: "transcribe",
      target: "a.wav",
      engine: "local",
      language: "en",
    });
  });

  it("takes the language from POINTCAST_LANGUAGE unless --language is given", () => {
    expect(parseCommandLine(["process"], { POINTCAST_LANGUAGE: "es" })).toMatchObject({ language: "es" });
    expect(parseCommandLine(["process", "--language", "en"], { POINTCAST_LANGUAGE: "es" })).toMatchObject({ language: "en" });
    expect(parseCommandLine(["process"], { POINTCAST_LANGUAGE: "" })).not.toHaveProperty("language");
  });

  it.each([["0"], ["-2"], ["four"], ["4abc"], ["1.5"]])("rejects --threads %s", (threads) => {
    expect(() => parseCommandLine(["process", "--threads", threads])).toThrow(CliError);
  });

  it("rejects an unknown engine", () => {
    expect(() => parseCommandLine(["process", "--engine", "whisperx"])).toThrow(/Unknown --engine "whisperx"/);
  });

  it("turns unknown options and missing values into a one-line CliError, not a stack trace", () => {
    expect(() => parseCommandLine(["process", "--langauge", "es"])).toThrow(
      `Unknown option '--langauge'. Run "pointcast --help" for the options.`,
    );
    expect(() => parseCommandLine(["process", "--model"])).toThrow(/argument missing\. Run "pointcast --help"/);
    expect(() => parseCommandLine(["process", "--model"])).toThrow(CliError);
  });

  it("rejects extra positionals instead of ignoring them", () => {
    expect(() => parseCommandLine(["process", "a", "b"])).toThrow(/Unexpected extra arguments: b/);
  });

  it("shows usage for a missing or unknown command, and for transcribe without a target", () => {
    expect(parseCommandLine([])).toEqual({ command: "usage", exitCode: 1 });
    expect(parseCommandLine(["record"])).toEqual({ command: "usage", exitCode: 1 });
    expect(parseCommandLine(["transcribe"])).toEqual({ command: "usage", exitCode: 1 });
    expect(parseCommandLine(["--help"])).toEqual({ command: "usage", exitCode: 0 });
    expect(parseCommandLine(["--version"])).toEqual({ command: "version" });
    expect(parseCommandLine(["-v"])).toEqual({ command: "version" });
  });

  it("parses process --format", () => {
    expect(parseCommandLine(["process", "--format", "requests"])).toMatchObject({ format: "requests" });
    expect(parseCommandLine(["process"])).not.toHaveProperty("format");
  });

  it("rejects an unknown --format", () => {
    expect(() => parseCommandLine(["process", "--format", "fancy"])).toThrow(/Unknown --format "fancy"/);
  });

  it("parses process --layout and rejects an unknown one", () => {
    expect(parseCommandLine(["process", "--layout", "dom-first"])).toMatchObject({ layout: "dom-first" });
    expect(parseCommandLine(["process"])).not.toHaveProperty("layout");
    expect(() => parseCommandLine(["process", "--layout", "sideways"])).toThrow(/Unknown --layout "sideways"/);
  });

  it("parses mcp, with and without --dir and --no-handoff", () => {
    expect(parseCommandLine(["mcp"])).toEqual({ command: "mcp" });
    expect(parseCommandLine(["mcp", "--no-handoff"])).toEqual({ command: "mcp", noHandoff: true });
    expect(parseCommandLine(["mcp", "--dir", "some/dir"])).toEqual({ command: "mcp", dir: "some/dir" });
  });

  it("parses --repo for process and mcp (a project folder)", () => {
    expect(parseCommandLine(["process", "--repo", "../app"])).toMatchObject({ command: "process", repo: "../app" });
    expect(parseCommandLine(["process"])).not.toHaveProperty("repo");
    expect(parseCommandLine(["mcp", "--repo", "../app"])).toEqual({ command: "mcp", repo: "../app" });
  });

  it("parses issue: creates by default, --dry-run and --open instead, --ref and a session", () => {
    expect(parseCommandLine(["issue", "--repo", "octo/web"])).toEqual({ command: "issue", repo: "octo/web", mode: "create" });
    expect(parseCommandLine(["issue", "s/dir", "--repo", "octo/web", "--ref", "dev", "--dry-run", "--dir", "base"])).toEqual({
      command: "issue",
      target: "s/dir",
      dir: "base",
      repo: "octo/web",
      ref: "dev",
      mode: "dry-run",
    });
    expect(parseCommandLine(["issue", "--repo", "octo/web", "--open"])).toMatchObject({ mode: "open" });
  });

  it("rejects issue without --repo, or with both --dry-run and --open", () => {
    expect(() => parseCommandLine(["issue"])).toThrow(/issue needs --repo owner\/name/);
    expect(() => parseCommandLine(["issue", "--repo", "o/r", "--dry-run", "--open"])).toThrow(/either --dry-run or --open/);
  });
  it("parses doctor and its flags", () => {
    expect(parseCommandLine(["doctor"])).toEqual({ command: "doctor" });
    expect(parseCommandLine(["doctor", "--dir", "base", "--online", "--json"])).toEqual({ command: "doctor", dir: "base", online: true, json: true });
    expect(() => parseCommandLine(["doctor", "somewhere"])).toThrow(CliError);
  });
});
