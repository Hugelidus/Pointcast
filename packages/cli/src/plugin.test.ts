import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createServer } from "./mcp/server";
import { connectClient } from "./mcp/test-transport";

/**
 * Route 2: the Claude Code plugin in integrations/claude-code-plugin and the marketplace file at
 * the repository root. `claude plugin validate` is the authoritative check (run it by hand, see
 * the plugin's README); this test keeps the files consistent with each other and with this CLI:
 * the MCP server they start, and the tool names the /pointcast skill is allowed to call.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLUGIN = join(ROOT, "integrations/claude-code-plugin");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;

/** The YAML frontmatter of a SKILL.md, flat "key: value" lines only (all this skill uses). */
function frontmatter(markdown: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  expect(block, "SKILL.md starts with a frontmatter block").not.toBeNull();
  return Object.fromEntries(
    block![1]!.split(/\r?\n/).map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"(.*)"$/, "$1")];
    }),
  );
}

describe("Claude Code plugin", () => {
  const manifest = readJson(join(PLUGIN, ".claude-plugin/plugin.json"));
  const mcp = readJson(join(PLUGIN, ".mcp.json"));

  it("has a kebab-case name, a version and a description", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeTruthy();
  });

  it("starts this CLI's MCP server through npx", () => {
    const servers = Object.keys(mcp.mcpServers);
    expect(servers).toEqual(["pointcast"]);
    expect(mcp.mcpServers.pointcast).toEqual({ command: "npx", args: ["-y", "pointcast", "mcp"] });
  });

  it("gives /pointcast only this server's tools, by their plugin tool names", async () => {
    const skill = readFileSync(join(PLUGIN, "skills/pointcast/SKILL.md"), "utf8");
    const meta = frontmatter(skill);
    expect(meta.description).toBeTruthy();
    expect(skill).toContain("get_session");
    expect(skill).toContain('"latest"');

    // Claude Code names a plugin's MCP tools mcp__plugin_<plugin>_<server>__<tool>.
    const prefix = `mcp__plugin_${manifest.name}_${Object.keys(mcp.mcpServers)[0]}__`;
    const allowed = meta["allowed-tools"]!.split(/[\s,]+/);
    expect(allowed.every((tool) => tool.startsWith(prefix))).toBe(true);

    const server = createServer({ repoRoot: ROOT });
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    expect(allowed.map((tool) => tool.slice(prefix.length)).sort()).toEqual(tools.map((tool) => tool.name).sort());
    await client.close();
    await server.close();
  });

  it("is listed by the repository's marketplace, which Claude Code reads from .claude-plugin/", () => {
    const marketplace = readJson(join(ROOT, ".claude-plugin/marketplace.json"));
    expect(marketplace.name).toBeTruthy();
    expect(marketplace.owner?.name).toBeTruthy();
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === manifest.name);
    expect(entry.source).toBe("./integrations/claude-code-plugin");
    expect(existsSync(join(ROOT, entry.source, ".claude-plugin/plugin.json"))).toBe(true);
  });
});
