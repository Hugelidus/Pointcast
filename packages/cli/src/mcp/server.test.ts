import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server";
import { connectClient } from "./test-transport";

const FIXTURE = join(__dirname, "../../../../dev/fixtures/sessions/e2e-es-v2");

/**
 * The one "smoke test beyond a plain unit test" the task asked for: it goes through the SDK's own
 * client (test-transport.ts), request/response framing and zod input validation, not just the
 * tool functions.
 */
describe("pointcast mcp server (smoke test)", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-mcp-server-"));
    mkdirSync(join(base, "2026-01-01_09-00-00"));
    cpSync(FIXTURE, join(base, "2026-01-02_09-00-00"), { recursive: true });
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("lists the 3 tools and can call each of them end-to-end over the wire protocol", async () => {
    const server = createServer({ dirFlag: base, repoRoot: base });
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_element", "get_session", "list_sessions"]);

    const listed = await client.callTool({ name: "list_sessions", arguments: {} });
    expect(JSON.stringify(listed.content)).toContain("2026-01-02_09-00-00");

    const session = await client.callTool({ name: "get_session", arguments: { id: "latest" } });
    expect(JSON.stringify(session.content)).toContain("Quantity");
    // The header says what the spec holds, in the user's terms: no fusion jargon, no characters.
    const [title, , header] = (session.content as Array<{ text: string }>)[0]!.text.split("\n");
    expect([title, header]).toEqual(["# 2026-09-26_20-29-01", "2 requests · 10 elements · ~470 tokens"]);

    const element = await client.callTool({ name: "get_element", arguments: { id: "latest", eventId: "e1" } });
    expect(JSON.stringify(element.content)).toContain("Quantity");

    const missing = await client.callTool({ name: "get_element", arguments: { id: "latest", eventId: "nope" } });
    expect(missing.isError).toBe(true);

    await client.close();
    await server.close();
  });

  it("marks every tool read-only, and answers list_sessions with an object", async () => {
    const server = createServer({ dirFlag: base, repoRoot: base });
    const client = await connectClient(server);

    // Gemini CLI's plan mode refuses MCP tools without readOnlyHint.
    const { tools } = await client.listTools();
    expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ["list_sessions", true],
      ["get_session", true],
      ["get_element", true],
    ]);

    // Gemini CLI copies a tool's JSON text into structuredContent, which MCP requires to be an
    // object: a bare array made every list_sessions call fail there.
    const listed = await client.callTool({ name: "list_sessions", arguments: {} });
    const parsed = JSON.parse((listed.content as Array<{ text: string }>)[0]!.text) as unknown;
    // The folder name, the id the other tools take (this fixture's session.json has another).
    expect(parsed).toEqual({ sessions: [expect.objectContaining({ id: "2026-01-02_09-00-00" })] });

    await client.close();
    await server.close();
  });
});
