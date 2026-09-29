import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "./version";

/**
 * Route 3: the Gemini CLI extension, gemini-extension.json and commands/pointcast.toml at the
 * repository root. `gemini extensions install https://github.com/Hugelidus/pointcast` reads the
 * manifest only at the root of the repository (or of a release's source archive): it rejects a
 * URL into a subfolder and has no --path option. `gemini extensions validate .` is the
 * authoritative check for the manifest (run it by hand); this test keeps both files consistent
 * with this CLI and with the plugin's skill, which /pointcast repeats word for word.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLUGIN = join(ROOT, "integrations/claude-code-plugin");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;

/**
 * The whole command file: comment lines, `description = "…"` with no escapes, and
 * `prompt = '''…'''`, a literal string, so its value is exactly the text between the quotes
 * (minus the newline right after the opening ones). Anything else fails the match.
 */
function commandFile(toml: string): { description: string; prompt: string } | undefined {
  const match = /^(?:#.*\r?\n)*description = "([^"\\]*)"\r?\nprompt = '''\r?\n([\s\S]*?)'''\r?\n$/.exec(toml);
  return match ? { description: match[1]!, prompt: match[2]! } : undefined;
}

describe("Gemini CLI extension", () => {
  const manifest = readJson(join(ROOT, "gemini-extension.json"));

  it("has a valid name and the plugin's version", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.version).toBe(readJson(join(PLUGIN, ".claude-plugin/plugin.json")).version);
  });

  it("starts this CLI's MCP server through npx, pinned like the plugin, for the folder Gemini was launched in", () => {
    // Gemini replaces ${workspacePath} with that folder; being explicit keeps it right even if a
    // later Gemini starts servers elsewhere.
    expect(manifest.mcpServers).toEqual({
      pointcast: { command: "npx", args: ["-y", `pointcast@${VERSION}`, "mcp", "--repo", "${workspacePath}"] },
    });
    expect(manifest.mcpServers.pointcast.args[1]).toBe(readJson(join(PLUGIN, ".mcp.json")).mcpServers.recordings.args[1]);
  });

  it("loads no context file into every Gemini session", () => {
    // Without this, a GEMINI.md at the repository root would be loaded for every user.
    expect(manifest.contextFileName).toEqual([]);
  });

  it("has a /pointcast command whose prompt is the plugin's skill, word for word", () => {
    const command = commandFile(readFileSync(join(ROOT, "commands/pointcast.toml"), "utf8"));
    expect(command, "commands/pointcast.toml has only comments, description and a ''' prompt").toBeDefined();
    const { description, prompt } = command!;
    expect(description).toBeTruthy();
    expect(description.length).toBeLessThanOrEqual(100); // Gemini cuts longer ones in /help

    // No {{args}}: Gemini then appends what the user typed, as Claude Code does for the skill.
    // No !{…} or @{…} either: Gemini would run a shell command or inject a file there.
    expect(prompt).not.toMatch(/\{\{args\}\}|!\{|@\{/);

    const skill = readFileSync(join(PLUGIN, "skills/pointcast/SKILL.md"), "utf8");
    const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    expect(prompt.replace(/\r\n/g, "\n").trim()).toBe(body.replace(/\r\n/g, "\n").trim());
  });
});
