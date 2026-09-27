import { describe, expect, it } from "vitest";
import { parseCommandLine, USAGE } from "./args";

/**
 * args.test.ts already asserts the full parsed object for `process` with `toEqual` (both with
 * every flag set and with none), so `--no-copy` is kept out of that file: it is a new, separate
 * test file per this task's constraints, not an edit to an existing one.
 */
describe("parseCommandLine --no-copy", () => {
  it("is absent (copy stays on) when --no-copy is not given", () => {
    expect(parseCommandLine(["process"])).not.toHaveProperty("noCopy");
    expect(parseCommandLine(["process", "some/dir"])).not.toHaveProperty("noCopy");
  });

  it("sets noCopy: true when --no-copy is given", () => {
    expect(parseCommandLine(["process", "--no-copy"])).toMatchObject({ command: "process", noCopy: true });
  });

  it("combines with other process flags", () => {
    expect(parseCommandLine(["process", "some/dir", "--stdout", "--no-copy"])).toEqual({
      command: "process",
      target: "some/dir",
      engine: "local",
      force: false,
      toStdout: true,
      noCopy: true,
    });
  });

  it("documents --no-copy in --help output", () => {
    expect(USAGE).toContain("--no-copy");
  });
});
