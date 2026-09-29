import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionFile } from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectWith, sessionWithChain, SOURCES } from "../resolve/test-support";
import { createServer } from "./server";
import { resolveSessionDirById } from "./sessions";
import { connectClient } from "./test-transport";

const HERE = "2026-09-26_20-29-01";
const ELSEWHERE = "2026-09-28_10-00-00";

/** The chain session, pointing at files no project in these tests has. */
function sessionFromElsewhere(): string {
  const dir = sessionWithChain();
  const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionFile;
  session.id = ELSEWHERE;
  session.events.find((e) => e.id === "e2")!.element.renderedBy = [{ file: "src/Elsewhere.tsx", line: 3 }];
  writeFileSync(join(dir, "session.json"), JSON.stringify(session));
  return dir;
}

describe('"latest-here": the newest recording made on this project', () => {
  let base: string;
  let repo: string;
  let empty: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-mcp-latest-here-"));
    renameSync(sessionWithChain(), join(base, HERE));
    renameSync(sessionFromElsewhere(), join(base, ELSEWHERE));
    repo = projectWith(SOURCES);
    empty = projectWith({ "README.md": "nothing here" });
  });
  afterEach(() => {
    for (const dir of [base, repo, empty]) rmSync(dir, { recursive: true, force: true });
  });

  it("passes over newer recordings from another project, and says so", async () => {
    const here = await resolveSessionDirById({ dirFlag: base }, "latest-here", { root: repo, explicit: false });
    expect(here).toEqual({
      dir: join(base, HERE),
      skippedNewer: [],
      note: `Skipped 1 newer recording from another project (${ELSEWHERE}).`,
    });
    // "latest" is unchanged: the newest, whatever its project.
    expect((await resolveSessionDirById({ dirFlag: base }, "latest", { root: repo, explicit: false })).dir).toBe(join(base, ELSEWHERE));
  });

  it("falls back to the newest when none is from this project, with a note", async () => {
    const result = await resolveSessionDirById({ dirFlag: base }, "latest-here", { root: empty, explicit: false });
    expect(result.dir).toBe(join(base, ELSEWHERE));
    expect(result.note).toBe(`None of the 2 newest recordings points at files in \`${empty}\`: this is the newest one.`);
  });

  it("takes a recording that names no files (it cannot tell), and is plain latest with no project folder", async () => {
    const newest = "2026-09-29_08-00-00";
    renameSync(sessionFromElsewhere(), join(base, newest));
    const session = JSON.parse(readFileSync(join(base, newest, "session.json"), "utf8")) as SessionFile;
    for (const event of session.events) delete event.element.renderedBy;
    writeFileSync(join(base, newest, "session.json"), JSON.stringify(session));
    expect(await resolveSessionDirById({ dirFlag: base }, "latest-here", { root: repo, explicit: false })).toEqual({
      dir: join(base, newest),
      skippedNewer: [],
    });
    const missing = join(repo, "not-there");
    expect((await resolveSessionDirById({ dirFlag: base }, "latest-here", { root: missing, explicit: false })).dir).toBe(join(base, newest));
  });

  it("over the wire: get_session puts the note above the spec, with no warning", async () => {
    const server = createServer({ dirFlag: base, repoRoot: repo });
    const client = await connectClient(server);
    const result = await client.callTool({ name: "get_session", arguments: { id: "latest-here" } });
    const body = (result.content as { text: string }[])[0]!.text;
    expect(body.split("\n")[0]).toBe(`Skipped 1 newer recording from another project (${ELSEWHERE}).`);
    expect(body).toContain(`# ${HERE}`);
    expect(body).not.toContain("**Warning:**");
    await client.close();
    await server.close();
  });
});
