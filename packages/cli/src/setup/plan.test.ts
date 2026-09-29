import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursorServer, DJANGO_PIP_INSTALL, planSetup, type AgentFinding, type PlanEnvironment } from "./plan";

/**
 * Every test gets its own temporary project and home folder, and a fake PATH lookup: nothing
 * reads the real ~/.claude, ~/.codex, ~/.gemini or ~/.cursor, and no agent is run.
 */

let root: string;
let repo: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pointcast-setup-"));
  repo = path.join(root, "project");
  home = path.join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function env(onPath: string[] = [], overrides: Partial<PlanEnvironment> = {}): PlanEnvironment {
  return {
    version: "0.6.0",
    repo,
    home,
    env: {},
    platform: process.platform,
    which: (command) => (onPath.includes(command) ? path.join(root, "bin", `${command}.cmd`) : undefined),
    ...overrides,
  };
}

async function agent(id: AgentFinding["id"], environment: PlanEnvironment): Promise<AgentFinding> {
  const found = (await planSetup(environment)).agents.find((a) => a.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe("planSetup: agents", () => {
  it("reports every agent as not found on a bare machine, with nothing to do", async () => {
    const plan = await planSetup(env());
    expect(plan.agents.map((a) => [a.id, a.state])).toEqual([
      ["claude-code", "not-found"],
      ["codex", "not-found"],
      ["gemini", "not-found"],
      ["cursor", "not-found"],
    ]);
    expect(plan.agents.every((a) => a.action === undefined)).toBe(true);
  });

  it("installs the plugin in Claude Code, Codex and Gemini with their own commands", async () => {
    const plan = await planSetup(env(["claude", "codex", "gemini"]));
    const commands = (id: string) => {
      const action = plan.agents.find((a) => a.id === id)?.action;
      return action?.kind === "run" ? action.steps.map((s) => [s.command, ...s.args].join(" ")) : [];
    };
    expect(commands("claude-code")).toEqual(["claude plugin marketplace add Hugelidus/pointcast", "claude plugin install pointcast@pointcast"]);
    expect(commands("codex")).toEqual(["codex plugin marketplace add Hugelidus/pointcast", "codex plugin add pointcast@pointcast"]);
    expect(commands("gemini")).toEqual(["gemini extensions install https://github.com/Hugelidus/pointcast"]);
    const claude = plan.agents.find((a) => a.id === "claude-code")!;
    expect(claude.state).toBe("missing");
    expect(claude.detail).toContain("claude on PATH");
    // Only the marketplace step may fail (already added); the install decides.
    expect(claude.action?.kind === "run" && claude.action.steps.map((s) => s.mayFail === true)).toEqual([true, false]);
  });

  it("skips Claude Code when the plugin or a pointcast MCP server is already there", async () => {
    write(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "pointcast@pointcast": [{}] } }));
    expect(await agent("claude-code", env(["claude"]))).toMatchObject({ state: "configured" });
    rmSync(path.join(home, ".claude"), { recursive: true });

    write(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { pointcast: { command: "npx" } } }));
    expect((await agent("claude-code", env(["claude"]))).detail).toContain("user scope");

    write(path.join(home, ".claude.json"), JSON.stringify({ projects: { [repo.replace(/\\/g, "/")]: { mcpServers: { pointcast: {} } } } }));
    expect((await agent("claude-code", env(["claude"]))).detail).toContain("local scope");

    write(path.join(home, ".claude.json"), JSON.stringify({ projects: { "/some/other/project": { mcpServers: { pointcast: {} } } } }));
    expect((await agent("claude-code", env(["claude"]))).state).toBe("missing");

    write(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { pointcast: {} } }));
    expect((await agent("claude-code", env(["claude"]))).detail).toContain(".mcp.json");
  });

  it("reads Claude Code's plugins from CLAUDE_CONFIG_DIR when it is set", async () => {
    const configDir = path.join(root, "claude-config");
    write(path.join(configDir, "plugins", "installed_plugins.json"), '{"plugins":{"pointcast@pointcast":[]}}');
    expect((await agent("claude-code", env(["claude"]))).state).toBe("missing");
    expect((await agent("claude-code", env(["claude"], { env: { CLAUDE_CONFIG_DIR: configDir } }))).state).toBe("configured");
  });

  it("skips Codex when config.toml has the plugin or a pointcast server, under CODEX_HOME if set", async () => {
    write(path.join(home, ".codex", "config.toml"), '[plugins."browser@openai-bundled"]\nenabled = true\n');
    expect((await agent("codex", env(["codex"]))).state).toBe("missing");
    write(path.join(home, ".codex", "config.toml"), '[plugins."pointcast@pointcast"]\nenabled = true\n');
    expect((await agent("codex", env(["codex"]))).state).toBe("configured");
    write(path.join(home, ".codex", "config.toml"), '[mcp_servers.pointcast]\ncommand = "npx"\n');
    expect((await agent("codex", env(["codex"]))).detail).toContain("MCP server");

    const codexHome = path.join(root, "codex-home");
    write(path.join(codexHome, "config.toml"), "");
    expect((await agent("codex", env(["codex"], { env: { CODEX_HOME: codexHome } }))).state).toBe("missing");
  });

  it("skips Gemini CLI when the extension is installed or a settings file has the server", async () => {
    mkdirSync(path.join(home, ".gemini", "extensions", "pointcast"), { recursive: true });
    expect((await agent("gemini", env(["gemini"]))).state).toBe("configured");
    rmSync(path.join(home, ".gemini"), { recursive: true });
    write(path.join(repo, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { pointcast: {} } }));
    expect((await agent("gemini", env(["gemini"]))).detail).toContain("this project's settings");
  });
});

describe("planSetup: Cursor", () => {
  const cursorFile = () => path.join(repo, ".cursor", "mcp.json");

  it("finds Cursor by the project's .cursor folder or on PATH", async () => {
    expect((await agent("cursor", env())).state).toBe("not-found");
    expect((await agent("cursor", env(["cursor"]))).state).toBe("missing");
    mkdirSync(path.join(repo, ".cursor"));
    expect((await agent("cursor", env())).detail).toContain(".cursor folder");
  });

  it("creates .cursor/mcp.json with the MCP server pinned to this CLI's exact version", async () => {
    const found = await agent("cursor", env(["cursor"]));
    expect(found.action).toEqual({
      kind: "write",
      file: cursorFile(),
      content: `${JSON.stringify({ mcpServers: { pointcast: cursorServer("0.6.0") } }, null, 2)}\n`,
    });
    expect(cursorServer("0.6.0").args).toEqual(["-y", "pointcast@0.6.0", "mcp", "--repo", "${workspaceFolder}"]);
  });

  it("merges into an existing file, keeping other servers and keys", async () => {
    write(cursorFile(), JSON.stringify({ mcpServers: { other: { command: "other-server" } }, extra: 1 }));
    const found = await agent("cursor", env());
    expect(found.state).toBe("missing");
    expect(found.action?.kind === "write" && JSON.parse(found.action.content)).toEqual({
      mcpServers: { other: { command: "other-server" }, pointcast: cursorServer("0.6.0") },
      extra: 1,
    });
  });

  it("updates another pin, keeping the entry's own keys, and skips the same pin", async () => {
    write(cursorFile(), JSON.stringify({ mcpServers: { pointcast: { command: "npx", args: ["-y", "pointcast@0.2", "mcp"], env: { POINTCAST_DIR: "x" } } } }));
    const outdated = await agent("cursor", env());
    expect(outdated.state).toBe("outdated");
    expect(outdated.detail).toContain("npx -y pointcast@0.2 mcp");
    expect(outdated.action?.kind === "write" && JSON.parse(outdated.action.content).mcpServers.pointcast).toEqual({
      ...cursorServer("0.6.0"),
      env: { POINTCAST_DIR: "x" },
    });

    write(cursorFile(), JSON.stringify({ mcpServers: { pointcast: cursorServer("0.6.0") } }));
    expect(await agent("cursor", env())).toMatchObject({ state: "configured" });
  });

  it("leaves a file that is not valid JSON alone and says what to add by hand", async () => {
    write(cursorFile(), '{ "mcpServers": { // a comment\n } }');
    const found = await agent("cursor", env());
    expect(found.state).toBe("unreadable");
    expect(found.action).toBeUndefined();
    expect(found.detail).toContain('"pointcast@0.6.0"');
  });

  it("counts a pointcast server in ~/.cursor/mcp.json as set up", async () => {
    write(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { pointcast: {} } }));
    expect((await agent("cursor", env(["cursor"]))).state).toBe("configured");
  });
});

describe("planSetup: stack", () => {
  it("prints the pointcast-django steps for a Django project, naming its settings file", async () => {
    write(path.join(repo, "manage.py"), "#!/usr/bin/env python\n");
    write(path.join(repo, "shop", "settings.py"), "DEBUG = True\nINSTALLED_APPS = ['django.contrib.admin']\n");
    const [hint] = (await planSetup(env())).stack;
    expect(hint?.id).toBe("django");
    expect(hint?.steps.join("\n")).toContain(DJANGO_PIP_INSTALL);
    expect(hint?.steps.join("\n")).toContain('At the end of shop/settings.py:  if DEBUG: INSTALLED_APPS += ["pointcast_django"]');
  });

  it("finds settings in a settings/ package, and says when pointcast_django is already there", async () => {
    write(path.join(repo, "config", "settings", "base.py"), "INSTALLED_APPS = []\n");
    write(path.join(repo, "config", "settings", "dev.py"), 'from .base import *\nINSTALLED_APPS += ["pointcast_django"]\n');
    const [hint] = (await planSetup(env())).stack;
    expect(hint).toMatchObject({ id: "django", steps: [] });
    expect(hint?.summary).toContain("already in INSTALLED_APPS");
  });

  it("says nothing is needed for React, Vue, Svelte, Vite or Next, and when the clipboard lacks lines", async () => {
    write(path.join(repo, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^7.0.0" } }));
    const [vite] = (await planSetup(env())).stack;
    expect(vite).toMatchObject({ id: "frontend", summary: "Frontend (react, vite): nothing to add in development." });
    expect(vite?.steps).toHaveLength(1);

    write(path.join(repo, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }));
    const [next] = (await planSetup(env())).stack;
    expect(next?.steps.join("\n")).toContain("no `text at:` lines");
  });

  it("says elements get the DOM description when no framework is found", async () => {
    write(path.join(repo, "package.json"), JSON.stringify({ dependencies: { express: "5" } }));
    expect((await planSetup(env())).stack.map((h) => h.id)).toEqual(["none"]);
  });

  describe("an app one folder down, when this folder is no project", () => {
    const REACT_VITE = JSON.stringify({ dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^7.0.0" } });

    it("finds a React + Vite app in a subfolder and says where it is", async () => {
      write(path.join(repo, "web", "package.json"), REACT_VITE);
      write(path.join(repo, "README.md"), "# notes\n");
      const stack = (await planSetup(env())).stack;
      expect(stack).toEqual([expect.objectContaining({ id: "frontend", summary: "Frontend (react, vite) in web/: nothing to add in development." })]);
    });

    it("finds a Django project in a subfolder, with its settings shown from here", async () => {
      write(path.join(repo, "api", "manage.py"), "#!/usr/bin/env python\n");
      write(path.join(repo, "api", "shop", "settings.py"), "INSTALLED_APPS = []\n");
      const [hint] = (await planSetup(env())).stack;
      expect(hint).toMatchObject({ id: "django" });
      expect(hint?.summary).toMatch(/^Django in api\/: add pointcast-django/);
      expect(hint?.steps.join("\n")).toContain("At the end of api/shop/settings.py:");
    });

    it("picks none when several subfolders qualify, and lists them", async () => {
      write(path.join(repo, "web", "package.json"), REACT_VITE);
      write(path.join(repo, "admin", "package.json"), JSON.stringify({ dependencies: { vue: "^3.5.0" } }));
      write(path.join(repo, "docs", "package.json"), JSON.stringify({ dependencies: { express: "5" } }));
      const stack = (await planSetup(env())).stack;
      expect(stack).toEqual([
        {
          id: "several",
          summary:
            "Several projects one folder down, none picked: admin/ Frontend (vue); web/ Frontend (react, vite). Run pointcast setup in the app's own folder for its steps.",
          steps: [],
        },
      ]);
    });

    it("does not look down when this folder is a project, nor into hidden or dependency folders", async () => {
      write(path.join(repo, "package.json"), JSON.stringify({ dependencies: { express: "5" } }));
      write(path.join(repo, "web", "package.json"), REACT_VITE);
      expect((await planSetup(env())).stack.map((h) => h.id)).toEqual(["none"]);

      rmSync(path.join(repo, "package.json"));
      rmSync(path.join(repo, "web"), { recursive: true });
      write(path.join(repo, "node_modules", "package.json"), REACT_VITE);
      write(path.join(repo, ".cache", "package.json"), REACT_VITE);
      expect((await planSetup(env())).stack.map((h) => h.id)).toEqual(["none"]);
    });
  });

  it("always lists the browser extension steps, without opening anything", async () => {
    const plan = await planSetup(env());
    expect(plan.extension.join("\n")).toContain("https://github.com/Hugelidus/pointcast/releases");
    expect(plan.extension.join("\n")).toContain("Load unpacked");
  });
});
