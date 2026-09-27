import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXPORT_SNIPPET, projectWith, sessionWithChain, SOURCES, TOOLBAR } from "../resolve/test-support";
import { getElement } from "./get-element";
import { createServer } from "./server";
import { getSession } from "./sessions";
import { connectClient } from "./test-transport";

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[]).map((c) => c.text).join("\n");
}

describe("MCP tools resolve code locations in the project (route 1)", () => {
  let base: string;
  let sessionDir: string;
  let repo: string;
  let otherProject: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-mcp-repo-"));
    sessionDir = join(base, "2026-09-26_20-29-01");
    renameSync(sessionWithChain(), sessionDir);
    repo = projectWith(SOURCES, "apps/web/");
    otherProject = projectWith({ "README.md": "another app" });
  });
  afterEach(() => {
    for (const dir of [base, repo, otherProject]) rmSync(dir, { recursive: true, force: true });
  });

  it("get_session re-renders with the resolved line, even when session.md is on disk", async () => {
    writeFileSync(join(sessionDir, "session.md"), "# stale spec from the extension\n");
    const result = await getSession(sessionDir, { repo: { root: repo, explicit: false } });
    expect(result.warning).toBeUndefined();
    expect(result.markdown).toContain(`text at: \`${TOOLBAR}:4\``);
  });

  it("get_session warns, and serves the spec unresolved, when the project has none of the files", async () => {
    const result = await getSession(sessionDir, { repo: { root: otherProject, explicit: false } });
    expect(result.warning).toMatch(/^> \*\*Warning:\*\* .*another project/);
    expect(result.warning).not.toContain("\n");
    expect(result.markdown).not.toContain("text at:");
  });

  it("get_element fills element.resolved", async () => {
    const { event, warning } = await getElement(sessionDir, "e2", { repo: { root: repo, explicit: true } });
    expect(warning).toBeUndefined();
    expect(event.element.resolved).toEqual([{ kind: "text", file: TOOLBAR, line: 4, via: "repo", snippet: EXPORT_SNIPPET }]);
  });

  it("over the wire: the server's project by default, a 'repo' argument when given, the warning on top", async () => {
    const server = createServer({ dirFlag: base, repoRoot: repo });
    const client = await connectClient(server);

    const session = textOf(await client.callTool({ name: "get_session", arguments: { id: "latest" } }));
    expect(session).toContain(`text at: \`${TOOLBAR}:4\``);

    const wrong = textOf(await client.callTool({ name: "get_session", arguments: { id: "latest", repo: otherProject } }));
    expect(wrong.split("\n")[0]).toMatch(/^> \*\*Warning:\*\*/);

    const element = textOf(await client.callTool({ name: "get_element", arguments: { id: "latest", eventId: "e2", repo } }));
    expect(JSON.parse(element).element.resolved).toEqual([{ kind: "text", file: TOOLBAR, line: 4, via: "repo", snippet: EXPORT_SNIPPET }]);

    const missing = await client.callTool({ name: "get_session", arguments: { id: "latest", repo: join(repo, "nope") } });
    expect(missing.isError).toBe(true);

    await client.close();
    await server.close();
  });
});
