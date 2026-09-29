import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectWith, sessionWithChain, SOURCES } from "../resolve/test-support";
import { createServer } from "./server";
import { listSessions, pagesOf } from "./sessions";
import { connectClient } from "./test-transport";

function typedSession(id: string, url: string) {
  return JSON.stringify({
    schemaVersion: 2,
    id,
    startedAt: "2026-09-27T09:00:00.000Z",
    t0: 0,
    durationMs: 3000,
    recorder: { extensionVersion: "0.7.0", userAgent: "test" },
    inputMode: "typed",
    events: [
      {
        id: "e1",
        gesture: "point",
        tStart: 10,
        tEnd: 10,
        url,
        note: "Make this title bigger",
        element: { tag: "h1", text: "Orders", selector: "h1", selectorUnique: true, path: "main › h1", html: "<h1>Orders</h1>" },
      },
    ],
  });
}

describe("list_sessions says what each recording is", () => {
  let base: string;
  let repo: string;
  let other: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-mcp-list-"));
    // Voice, with a code chain into SOURCES, no session.md yet.
    renameSync(sessionWithChain(), join(base, "2026-09-26_20-29-01"));
    // Typed, no chain, session.md on disk.
    mkdirSync(join(base, "2026-09-27_09-00-00"));
    writeFileSync(join(base, "2026-09-27_09-00-00", "session.json"), typedSession("2026-09-27_09-00-00", "http://localhost:5173/orders?token=secret#top"));
    writeFileSync(join(base, "2026-09-27_09-00-00", "session.md"), "# UI change requests\n\n## Request 1\n\n> Make this title bigger [a]\n\n- [a] h1\n");
    repo = projectWith(SOURCES);
    other = projectWith({ "README.md": "another app" });
  });
  afterEach(() => {
    for (const dir of [base, repo, other]) rmSync(dir, { recursive: true, force: true });
  });

  it("gives pages, requests, elements, a preview, the project match and whether it is rendered", async () => {
    const sessions = await listSessions({ dirFlag: base }, 20, { root: repo, explicit: false });
    expect(sessions).toEqual([
      {
        id: "2026-09-27_09-00-00",
        startedAt: "2026-09-27T09:00:00.000Z",
        durationMs: 3000,
        pages: ["localhost:5173/orders"],
        requests: 1,
        elements: 1,
        preview: "Make this title bigger",
        matchesProject: "unknown",
        rendered: true,
      },
      {
        id: "2026-09-26_20-29-01",
        startedAt: "2026-09-26T18:29:01.845Z",
        durationMs: 11880,
        pages: ["127.0.0.1:5511/index.html", "127.0.0.1:5511/other.html", "127.0.0.1:5511/spa.html"],
        requests: 2,
        elements: 10,
        preview: "Esto me gustaría que estuviera filtrado por cantidad.",
        matchesProject: true,
        rendered: false,
      },
    ]);
    // Listing renders in memory only: nothing is written into the session folder.
    expect((await listSessions({ dirFlag: base }))[1]!.rendered).toBe(false);

    const elsewhere = await listSessions({ dirFlag: base }, 20, { root: other, explicit: true });
    expect(elsewhere.map((s) => s.matchesProject)).toEqual(["unknown", false]);
    await expect(listSessions({ dirFlag: base }, 20, { root: join(other, "nope"), explicit: true })).rejects.toThrow("does not exist");
  });

  it("sums up pages past the third", () => {
    const events = ["a", "b", "b", "c", "d", "e"].map((page) => ({ url: `https://app.test/${page}` }));
    expect(pagesOf({ events } as never)).toEqual(["app.test/a", "app.test/b", "app.test/c", "+2 more"]);
    expect(pagesOf({ events: [{ url: "not a url" }] } as never)).toEqual([]);
  });

  it("answers over the wire with one session per line, checked against the server's project", async () => {
    const server = createServer({ dirFlag: base, repoRoot: repo });
    const client = await connectClient(server);
    const listed = await client.callTool({ name: "list_sessions", arguments: {} });
    const body = (listed.content as { text: string }[])[0]!.text;
    expect(body.split("\n")).toHaveLength(4);
    expect(body.split("\n")[0]).toBe('{"sessions":[');
    const parsed = JSON.parse(body) as { sessions: { id: string; matchesProject: unknown }[] };
    expect(parsed.sessions.map((s) => [s.id, s.matchesProject])).toEqual([
      ["2026-09-27_09-00-00", "unknown"],
      ["2026-09-26_20-29-01", true],
    ]);
    await client.close();
    await server.close();
  });
});
