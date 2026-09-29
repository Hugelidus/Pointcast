import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * `pointcast setup` (D14), the looking half: which coding agents are on this machine, whether
 * pointcast is already set up in each, what the project is built with, and what setup would do
 * about it. Nothing here writes or runs anything: it reads files under the project and the home
 * folder it is given, and asks `which` about PATH. run.ts asks and acts.
 */

export type AgentId = "claude-code" | "codex" | "gemini" | "cursor";

/** One command an action runs. Every argument is a fixed token from this file (system.ts relies on it). */
export interface CommandStep {
  command: string;
  args: string[];
  /** A failure here is fine when the next step succeeds ("marketplace already added"). */
  mayFail?: true;
}

export type SetupAction =
  | { kind: "run"; steps: CommandStep[] }
  /** Writes `content` to `file` (a whole JSON file, other entries kept). */
  | { kind: "write"; file: string; content: string };

export type AgentState =
  /** The agent is not on this machine. */
  | "not-found"
  /** pointcast is already set up in it: nothing to do. */
  | "configured"
  /** Found, pointcast not set up: the action sets it up. */
  | "missing"
  /** Set up with another version: the action updates it. */
  | "outdated"
  /** Its config could not be read safely: `detail` says what to add by hand. */
  | "unreadable";

export interface AgentFinding {
  id: AgentId;
  name: string;
  state: AgentState;
  /** One line: how it was found, and what was found about pointcast. */
  detail: string;
  action?: SetupAction;
}

export interface StackHint {
  /** "several": no project here, and more than one in the folders one level down (none picked). */
  id: "django" | "frontend" | "none" | "several";
  summary: string;
  /** What the user does by hand, one line each (setup never edits the project's code). */
  steps: string[];
}

export interface SetupPlan {
  version: string;
  repo: string;
  agents: AgentFinding[];
  stack: StackHint[];
  extension: string[];
}

export interface PlanEnvironment {
  /** This CLI's version: Cursor's MCP server is pinned to it. */
  version: string;
  /** The project folder (absolute). */
  repo: string;
  /** The user's home folder (absolute): the agents keep their config under it. */
  home: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** The path of an executable on PATH, or undefined; never runs it. */
  which: (command: string) => string | undefined;
}

export const MARKETPLACE = "Hugelidus/pointcast";
export const PLUGIN = "pointcast@pointcast";
export const GEMINI_EXTENSION_URL = "https://github.com/Hugelidus/pointcast";
export const RELEASES_URL = "https://github.com/Hugelidus/pointcast/releases";
/** pointcast-django is not on PyPI yet (docs/launch/listings.md): install it from the repository. */
export const DJANGO_PIP_INSTALL = 'pip install "git+https://github.com/Hugelidus/pointcast#subdirectory=integrations/django"';

/** The `pointcast` entry Cursor gets: the same as packages/cli/README.md#cursor, pinned exactly. */
export function cursorServer(version: string): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", `pointcast@${version}`, "mcp", "--repo", "${workspaceFolder}"] };
}

type JsonRead = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; value: unknown; text: string };

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function readJson(file: string): Promise<JsonRead> {
  const text = await readText(file);
  if (text === undefined) return { kind: "missing" };
  try {
    return { kind: "ok", value: JSON.parse(text.replace(/^﻿/, "")), text };
  } catch {
    return { kind: "invalid" };
  }
}

async function isDirectory(target: string): Promise<boolean> {
  return stat(target).then((s) => s.isDirectory(), () => false);
}

async function isFile(target: string): Promise<boolean> {
  return stat(target).then((s) => s.isFile(), () => false);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `{ mcpServers: { pointcast: … } }`, the shape Claude Code, Gemini and Cursor share. */
function pointcastServer(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.mcpServers)) return undefined;
  const server = value.mcpServers.pointcast;
  return isRecord(server) ? server : undefined;
}

/** Paths compared the way the OS does: Windows ignores case and slash direction. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string) => {
    const resolved = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

const foundOnPath = (command: string, where: string) => `found (${command} on PATH: ${where})`;

async function claudeCode(e: PlanEnvironment): Promise<AgentFinding> {
  const base = { id: "claude-code" as const, name: "Claude Code" };
  const bin = e.which("claude");
  if (!bin) return { ...base, state: "not-found", detail: "not found (no claude on PATH)" };
  const found = foundOnPath("claude", bin);

  const configDir = e.env.CLAUDE_CONFIG_DIR || path.join(e.home, ".claude");
  const plugins = await readText(path.join(configDir, "plugins", "installed_plugins.json"));
  if (plugins?.includes(`"${PLUGIN}"`)) return { ...base, state: "configured", detail: `${found}; the pointcast plugin is installed` };

  const userConfigs = [path.join(e.home, ".claude.json"), ...(e.env.CLAUDE_CONFIG_DIR ? [path.join(e.env.CLAUDE_CONFIG_DIR, ".claude.json")] : [])];
  for (const file of userConfigs) {
    const read = await readJson(file);
    if (read.kind !== "ok") continue;
    if (pointcastServer(read.value)) return { ...base, state: "configured", detail: `${found}; a pointcast MCP server is set up (user scope)` };
    const projects = isRecord(read.value) && isRecord(read.value.projects) ? read.value.projects : {};
    for (const [project, settings] of Object.entries(projects)) {
      if (samePath(project, e.repo, e.platform) && pointcastServer(settings)) {
        return { ...base, state: "configured", detail: `${found}; a pointcast MCP server is set up for this project (local scope)` };
      }
    }
  }
  const projectMcp = await readJson(path.join(e.repo, ".mcp.json"));
  if (projectMcp.kind === "ok" && pointcastServer(projectMcp.value)) {
    return { ...base, state: "configured", detail: `${found}; this project's .mcp.json has a pointcast MCP server` };
  }

  return {
    ...base,
    state: "missing",
    detail: `${found}; pointcast is not set up (installs the plugin: the MCP server and /pointcast)`,
    action: {
      kind: "run",
      steps: [
        { command: "claude", args: ["plugin", "marketplace", "add", MARKETPLACE], mayFail: true },
        { command: "claude", args: ["plugin", "install", PLUGIN] },
      ],
    },
  };
}

async function codex(e: PlanEnvironment): Promise<AgentFinding> {
  const base = { id: "codex" as const, name: "Codex" };
  const bin = e.which("codex");
  if (!bin) return { ...base, state: "not-found", detail: "not found (no codex on PATH)" };
  const found = foundOnPath("codex", bin);

  const config = await readText(path.join(e.env.CODEX_HOME || path.join(e.home, ".codex"), "config.toml"));
  if (config !== undefined) {
    if (/^\s*\[plugins\.(["'])pointcast@pointcast\1\]/m.test(config)) {
      return { ...base, state: "configured", detail: `${found}; the pointcast plugin is installed` };
    }
    if (/^\s*\[mcp_servers\.(?:pointcast|"pointcast"|'pointcast')\]/m.test(config)) {
      return { ...base, state: "configured", detail: `${found}; a pointcast MCP server is set up` };
    }
  }
  return {
    ...base,
    state: "missing",
    detail: `${found}; pointcast is not set up (installs the plugin: the MCP server and $pointcast:pointcast)`,
    action: {
      kind: "run",
      steps: [
        { command: "codex", args: ["plugin", "marketplace", "add", MARKETPLACE], mayFail: true },
        { command: "codex", args: ["plugin", "add", PLUGIN] },
      ],
    },
  };
}

async function gemini(e: PlanEnvironment): Promise<AgentFinding> {
  const base = { id: "gemini" as const, name: "Gemini CLI" };
  const bin = e.which("gemini");
  if (!bin) return { ...base, state: "not-found", detail: "not found (no gemini on PATH)" };
  const found = foundOnPath("gemini", bin);

  if (await isDirectory(path.join(e.home, ".gemini", "extensions", "pointcast"))) {
    return { ...base, state: "configured", detail: `${found}; the pointcast extension is installed` };
  }
  for (const [file, scope] of [
    [path.join(e.home, ".gemini", "settings.json"), "user settings"],
    [path.join(e.repo, ".gemini", "settings.json"), "this project's settings"],
  ] as const) {
    const read = await readJson(file);
    if (read.kind === "ok" && pointcastServer(read.value)) {
      return { ...base, state: "configured", detail: `${found}; a pointcast MCP server is set up (${scope})` };
    }
  }
  return {
    ...base,
    state: "missing",
    detail: `${found}; pointcast is not set up (installs the extension: the MCP server and /pointcast)`,
    action: { kind: "run", steps: [{ command: "gemini", args: ["extensions", "install", GEMINI_EXTENSION_URL] }] },
  };
}

async function cursor(e: PlanEnvironment): Promise<AgentFinding> {
  const base = { id: "cursor" as const, name: "Cursor" };
  const hasFolder = await isDirectory(path.join(e.repo, ".cursor"));
  const bin = e.which("cursor");
  if (!hasFolder && !bin) return { ...base, state: "not-found", detail: "not found (no .cursor folder here, no cursor on PATH)" };
  const found = hasFolder ? "found (this project has a .cursor folder)" : foundOnPath("cursor", bin!);

  const global = await readJson(path.join(e.home, ".cursor", "mcp.json"));
  if (global.kind === "ok" && pointcastServer(global.value)) {
    return { ...base, state: "configured", detail: `${found}; ~/.cursor/mcp.json has a pointcast MCP server` };
  }

  const file = path.join(e.repo, ".cursor", "mcp.json");
  const wanted = cursorServer(e.version);
  const project = await readJson(file);
  if (project.kind === "invalid" || (project.kind === "ok" && !isRecord(project.value))) {
    return {
      ...base,
      state: "unreadable",
      detail:
        `${found}; .cursor/mcp.json is not a JSON object, so it is left alone. Add this under "mcpServers" by hand: ` +
        `"pointcast": ${JSON.stringify(wanted)}`,
    };
  }
  const config = project.kind === "ok" ? (project.value as Record<string, unknown>) : {};
  const existing = pointcastServer(config);
  if (existing && existing.command === wanted.command && JSON.stringify(existing.args) === JSON.stringify(wanted.args)) {
    return { ...base, state: "configured", detail: `${found}; .cursor/mcp.json runs pointcast@${e.version}` };
  }
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};
  // Other keys of an existing entry (env, …) are the user's: kept.
  const merged = { ...config, mcpServers: { ...servers, pointcast: { ...(existing ?? {}), ...wanted } } };
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const action: SetupAction = { kind: "write", file, content };
  if (existing) {
    return {
      ...base,
      state: "outdated",
      detail: `${found}; .cursor/mcp.json runs \`${[existing.command, ...(Array.isArray(existing.args) ? existing.args : [])].join(" ")}\`: updates it to pointcast@${e.version}`,
      action,
    };
  }
  return {
    ...base,
    state: "missing",
    detail: `${found}; pointcast is not set up (${project.kind === "ok" ? "adds" : "creates .cursor/mcp.json with"} the pointcast MCP server)`,
    action,
  };
}

/** Folders never worth reading for settings.py. */
const SKIP_DIRS = new Set(["node_modules", "venv", "env", "site-packages", "__pycache__", "dist", "build"]);

/** settings.py in the project, one folder down, or a settings/ package one folder down (base.py, dev.py…). */
async function djangoSettingsFiles(repo: string): Promise<string[]> {
  const candidates = [path.join(repo, "settings.py")];
  const entries = await readdir(repo, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    candidates.push(path.join(repo, entry.name, "settings.py"));
    const settingsDir = path.join(repo, entry.name, "settings");
    const inner = await readdir(settingsDir).catch(() => [] as string[]);
    for (const name of inner) if (name.endsWith(".py")) candidates.push(path.join(settingsDir, name));
  }
  const found: string[] = [];
  for (const file of candidates) {
    const text = await readText(file);
    if (text?.includes("INSTALLED_APPS")) found.push(file);
  }
  return found;
}

/** `base`: the folder setup runs in, which the hint's paths are shown from (the project, or its parent). */
async function django(repo: string, base = repo): Promise<StackHint | undefined> {
  const manage = await isFile(path.join(repo, "manage.py"));
  const settings = await djangoSettingsFiles(repo);
  if (!manage && settings.length === 0) return undefined;

  for (const file of settings) {
    if ((await readText(file))?.includes("pointcast_django")) {
      return {
        id: "django",
        summary: `Django: pointcast_django is already in INSTALLED_APPS (${path.relative(base, file).replace(/\\/g, "/")}). Nothing to do.`,
        steps: [],
      };
    }
  }
  const where = settings[0] ? path.relative(base, settings[0]).replace(/\\/g, "/") : "your settings.py";
  return {
    id: "django",
    summary: "Django: add pointcast-django, so each element leads with its template and line (development only).",
    steps: [
      `In your project's virtualenv: ${DJANGO_PIP_INSTALL}`,
      `At the end of ${where}:  if DEBUG: INSTALLED_APPS += ["pointcast_django"]`,
      "Setup does not edit your Python files. Details: integrations/django/README.md in the pointcast repository.",
    ],
  };
}

const FRONTEND = ["react", "vue", "svelte", "vite", "next"] as const;

async function frontend(repo: string): Promise<StackHint | undefined> {
  const pkg = await readJson(path.join(repo, "package.json"));
  if (pkg.kind !== "ok" || !isRecord(pkg.value)) return undefined;
  const deps = { ...(isRecord(pkg.value.dependencies) ? pkg.value.dependencies : {}), ...(isRecord(pkg.value.devDependencies) ? pkg.value.devDependencies : {}) };
  const found = FRONTEND.filter((name) => name in deps);
  if (found.length === 0) return undefined;
  const steps = [
    "Dev builds of React 19, Vue 3 and Svelte 5 show each element's component chain; your agent's MCP server resolves its lines in this project.",
  ];
  if (found.includes("next") || !found.includes("vite")) {
    steps.push("Without a Vite dev server, a spec pasted from the clipboard has the chain but no `text at:` lines; through the MCP server it has them.");
  }
  return { id: "frontend", summary: `Frontend (${found.join(", ")}): nothing to add in development.`, steps };
}

export const EXTENSION_STEPS = [
  "The Chrome Web Store listing is in review. Meanwhile, download the newest pointcast-<version>-chrome.zip from " +
    `${RELEASES_URL} and unzip it.`,
  "Open chrome://extensions (edge://extensions in Edge), turn on Developer mode, choose Load unpacked and pick the unzipped folder.",
  "Then record on your app on localhost: press Record, talk (or pick Typed) while you Alt+click things (Option+click on macOS), press Stop.",
];

/** What the project in `folder` is built with; paths shown from `base`. */
async function stackOf(folder: string, base = folder): Promise<StackHint[]> {
  return [await django(folder, base), await frontend(folder)].filter((hint): hint is StackHint => hint !== undefined);
}

/**
 * The stack of the one app one folder down, when the folder setup runs in is no project itself
 * (no package.json, no manage.py): a repository with the app in `web/` or `app/`. The CLI's
 * resolver already finds such an app from the repository root (appFolderOf), so setup is run
 * there too. Each hint says where the app is ("… in web/: …"). Two or more such folders: none is
 * picked, one line lists them. Hidden folders and SKIP_DIRS are not looked into.
 */
async function stackOneDown(repo: string): Promise<StackHint[]> {
  if ((await isFile(path.join(repo, "package.json"))) || (await isFile(path.join(repo, "manage.py")))) return [];
  const entries = await readdir(repo, { withFileTypes: true }).catch(() => []);
  const found: { name: string; hints: StackHint[] }[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const folder = path.join(repo, entry.name);
    if (!(await isFile(path.join(folder, "package.json"))) && !(await isFile(path.join(folder, "manage.py")))) continue;
    const hints = await stackOf(folder, repo);
    if (hints.length > 0) found.push({ name: entry.name, hints });
  }
  if (found.length === 1) {
    const [{ name, hints }] = found;
    return hints.map((hint) => ({ ...hint, summary: hint.summary.replace(/^([^:]*):/, `$1 in ${name}/:`) }));
  }
  if (found.length > 1) {
    // "web/ Frontend (react, vite)": each hint's summary up to its colon.
    const listed = found.map(({ name, hints }) => `${name}/ ${hints.map((hint) => hint.summary.replace(/:.*$/, "")).join(" + ")}`);
    return [
      {
        id: "several",
        summary: `Several projects one folder down, none picked: ${listed.join("; ")}. Run pointcast setup in the app's own folder for its steps.`,
        steps: [],
      },
    ];
  }
  return [];
}

export async function planSetup(e: PlanEnvironment): Promise<SetupPlan> {
  const agents = [await claudeCode(e), await codex(e), await gemini(e), await cursor(e)];
  const here = await stackOf(e.repo);
  const stack = here.length > 0 ? here : await stackOneDown(e.repo);
  if (stack.length === 0) {
    stack.push({
      id: "none",
      summary: "No Django, React, Vue or Svelte project found here: elements get the DOM description (selector, path, HTML). Nothing to add.",
      steps: [],
    });
  }
  return { version: e.version, repo: e.repo, agents, stack, extension: EXTENSION_STEPS };
}
