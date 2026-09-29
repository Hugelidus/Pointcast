import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createServer } from "./mcp/server";
import { connectClient } from "./mcp/test-transport";
import { VERSION } from "./version";

/**
 * Route 2: the plugin in integrations/claude-code-plugin and the marketplace file at the
 * repository root, read by Claude Code and by Codex. Codex takes the plugin's
 * .codex-plugin/plugin.json over .claude-plugin/plugin.json; both share .mcp.json and skills/.
 * `claude plugin validate` is the authoritative check (run it by hand, see the plugin's README);
 * this test keeps the files consistent with each other and with this CLI: the MCP server they
 * start, and the tool names the /pointcast skill is allowed to call.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLUGIN = join(ROOT, "integrations/claude-code-plugin");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
const minor = (version: string) => version.split(".").slice(0, 2).join(".");

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

describe("Claude Code and Codex plugin", () => {
  const manifest = readJson(join(PLUGIN, ".claude-plugin/plugin.json"));
  const codexManifest = readJson(join(PLUGIN, ".codex-plugin/plugin.json"));
  const mcp = readJson(join(PLUGIN, ".mcp.json"));

  it("has a kebab-case name, a version and a description", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeTruthy();
  });

  it("starts this CLI's MCP server through npx, pinned to this exact version", () => {
    const servers = Object.keys(mcp.mcpServers);
    expect(servers).toEqual(["pointcast"]);
    // npx reuses a cached copy of an unversioned package forever, so plugin users would never get
    // a new release. The exact version is what the Claude plugin directory requires: the package it
    // reviews is the one that runs.
    expect(mcp.mcpServers.pointcast).toEqual({ command: "npx", args: ["-y", `pointcast@${VERSION}`, "mcp"] });
    // Claude Code and Codex only reinstall a plugin whose version changed: a new pin needs one.
    expect(minor(manifest.version)).toBe(minor(VERSION));
  });

  it("gives /pointcast only this server's tools, by their plugin tool names", async () => {
    const skill = readFileSync(join(PLUGIN, "skills/pointcast/SKILL.md"), "utf8");
    const meta = frontmatter(skill);
    // Codex's plugin validator requires a name; the folder name keeps /pointcast as it was.
    expect(meta.name).toBe("pointcast");
    expect(meta.description).toBeTruthy();
    expect(skill).toContain("get_session");
    expect(skill).toContain('"latest-here"');

    // Claude Code names a plugin's MCP tools mcp__plugin_<plugin>_<server>__<tool>.
    const prefix = `mcp__plugin_${manifest.name}_${Object.keys(mcp.mcpServers)[0]}__`;
    const allowed = meta["allowed-tools"]!.split(/[\s,]+/);
    expect(allowed.every((tool) => tool.startsWith(prefix))).toBe(true);

    const server = createServer({ repoRoot: ROOT });
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    expect(allowed.map((tool) => tool.slice(prefix.length)).sort()).toEqual(tools.map((tool) => tool.name).sort());
    // Codex ignores allowed-tools, so the text itself names every tool it may call.
    for (const tool of tools) expect(skill).toContain(`\`${tool.name}\``);
    await client.close();
    await server.close();
  });

  it("words the skill for any agent: Codex and Gemini CLI show it as written", () => {
    const skill = readFileSync(join(PLUGIN, "skills/pointcast/SKILL.md"), "utf8");
    // Only Claude Code substitutes $ARGUMENTS, $0… and ${CLAUDE_PLUGIN_ROOT}. With no placeholder
    // it appends what the user typed after the skill, as Gemini CLI does for /pointcast.
    expect(skill).not.toMatch(/\$ARGUMENTS|\$\d|\$\{CLAUDE_/);
  });

  it("describes itself to Codex with the same name and version, from the same files", () => {
    expect(codexManifest.name).toBe(manifest.name);
    expect(codexManifest.version).toBe(manifest.version);
    expect(codexManifest.description).toBeTruthy();
    expect(codexManifest.skills).toBe("./skills/");
    expect(codexManifest.mcpServers).toBe("./.mcp.json");
    // The fields Codex's own plugin validator requires (plugin-creator/scripts/validate_plugin.py).
    for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
      expect(codexManifest.interface[field], field).toBeTruthy();
    }
    expect(codexManifest.interface.capabilities.length).toBeGreaterThan(0);
    expect(codexManifest.interface.defaultPrompt.length).toBeGreaterThan(0);
  });

  it("is listed by the repository's marketplace, which Claude Code and Codex read from .claude-plugin/", () => {
    const marketplace = readJson(join(ROOT, ".claude-plugin/marketplace.json"));
    expect(marketplace.name).toBeTruthy();
    expect(marketplace.owner?.name).toBeTruthy();
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === manifest.name);
    expect(entry.source).toBe("./integrations/claude-code-plugin");
    expect(existsSync(join(ROOT, entry.source, ".claude-plugin/plugin.json"))).toBe(true);
    expect(existsSync(join(ROOT, entry.source, ".codex-plugin/plugin.json"))).toBe(true);
  });
});
