import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "../errors";
import { readSessionFile } from "../process/session-file";
import { runProcess } from "../process/run";
import { describeResolution, resolveWithRepo } from "./local";
import { APP, EXPORT_SNIPPET, projectWith, sessionWithChain, SOURCES, TOOLBAR } from "./test-support";

describe("route 1: resolving against a local project", () => {
  const scratch: string[] = [];
  const keep = (dir: string) => (scratch.push(dir), dir);
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the chain's text to its line, stamped via repo, in a monorepo package too", async () => {
    const session = await readSessionFile(keep(sessionWithChain()));
    for (const prefix of ["", "apps/web/"]) {
      const result = await resolveWithRepo(session, keep(projectWith(SOURCES, prefix)), { explicit: true });
      expect(result.status).toBe("resolved");
      const e2 = result.session.events.find((e) => e.id === "e2")!;
      // Paths are shown from the folder the agent works in (pass 2): `apps/web/src/…` opens as written.
      expect(e2.element.resolved).toEqual([{ kind: "text", file: `${prefix}${TOOLBAR}`, line: 4, via: "repo", snippet: EXPORT_SNIPPET }]);
      expect(describeResolution(result, { explicit: true })).toMatch(/^code locations: 1 found in /);
    }
  });

  it("shows every path from the repository root when the app is one subfolder of it (pass 2)", async () => {
    const session = await readSessionFile(keep(sessionWithChain()));
    const root = keep(projectWith({ ...SOURCES, "README.md": "repo" }, "web/"));
    const result = await resolveWithRepo(session, root, { explicit: true });
    const e2 = result.session.events.find((e) => e.id === "e2")!;
    expect(e2.element.renderedBy?.map((frame) => frame.file)).toEqual([`web/${TOOLBAR}`, `web/${APP}`]);
    expect(e2.element.resolved?.[0]?.file).toBe(`web/${TOOLBAR}`);
    // The recording itself is not changed.
    expect(session.events.find((e) => e.id === "e2")!.element.renderedBy?.[0]?.file).toBe(TOOLBAR);
  });

  it("picks the app by all the session's paths in a monorepo, and changes nothing when two apps match (pass 2)", async () => {
    const session = await readSessionFile(keep(sessionWithChain()));
    // Both apps have App.tsx; only apps/web has the Toolbar: apps/web.
    const two = keep(projectWith({ [`apps/web/${TOOLBAR}`]: SOURCES[TOOLBAR], [`apps/web/${APP}`]: SOURCES[APP], [`apps/admin/${APP}`]: SOURCES[APP] }));
    const picked = await resolveWithRepo(session, two, { explicit: true });
    expect(picked.session.events.find((e) => e.id === "e2")!.element.resolved?.[0]?.file).toBe(`apps/web/${TOOLBAR}`);
    // Both have both files: no folder can be told, the paths stay as recorded (and nothing resolves).
    const same = keep(projectWith({ ...Object.fromEntries(Object.entries(SOURCES).flatMap(([file, text]) => [[`apps/web/${file}`, text], [`apps/admin/${file}`, text]])) }));
    const ambiguous = await resolveWithRepo(session, same, { explicit: true });
    const e2 = ambiguous.session.events.find((e) => e.id === "e2")!;
    expect(e2.element.renderedBy?.map((frame) => frame.file)).toEqual([TOOLBAR, APP]);
    expect(e2.element.resolved).toBeUndefined();
  });

  it("reports a project that has none of the recording's files", async () => {
    const session = await readSessionFile(keep(sessionWithChain()));
    const root = keep(projectWith({ "README.md": "other project" }));
    const result = await resolveWithRepo(session, root, { explicit: false });
    expect(result.status).toBe("mismatch");
    expect(result.session).toBe(session);
    expect(describeResolution(result, { explicit: false })).toContain("pass --repo <project folder>");
  });

  it("says there is nothing to resolve for a recording without a chain", async () => {
    const dir = keep(sessionWithChain());
    const session = await readSessionFile(dir);
    session.events.forEach((event) => delete event.element.renderedBy);
    const result = await resolveWithRepo(session, dir, { explicit: false });
    expect(result.status).toBe("no-chain");
    expect(describeResolution(result, { explicit: false })).toContain("no component chain");
  });

  it("fails on an explicit folder that does not exist, and not on a guessed one", async () => {
    const session = await readSessionFile(keep(sessionWithChain()));
    const missing = join(keep(projectWith({})), "nope");
    await expect(resolveWithRepo(session, missing, { explicit: true })).rejects.toThrow(CliError);
    expect((await resolveWithRepo(session, missing, { explicit: false })).status).toBe("mismatch");
  });

  it("pointcast process renders the resolved line, and leaves session.json as recorded", async () => {
    const sessionDir = keep(sessionWithChain());
    const before = await readSessionFile(sessionDir);
    const result = await runProcess({
      sessionDir,
      engine: "local",
      force: false,
      toStdout: true,
      repo: { root: keep(projectWith(SOURCES, "apps/web/")), explicit: true },
    });
    expect(result.resolution?.status).toBe("resolved");
    expect(result.markdown).toContain(`text at: \`apps/web/${TOOLBAR}:4\``);
    expect(await readSessionFile(sessionDir)).toEqual(before);
  });
});
