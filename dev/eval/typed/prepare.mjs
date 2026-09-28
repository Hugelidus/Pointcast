// Builds the B and C conditions of the typed evaluation from the recorded sessions, and snapshots
// every prompt before any agent run.
//
//   node dev/eval/typed/prepare.mjs --out <dir> --django-dir <locallibrary checkout>
//
// B  the Pointcast spec WITHOUT code: the recorded session.json with renderedBy, resolved and the
//    component's file/line removed (a Django element's component, a template name, is removed
//    whole), rendered by the CLI (`pointcast process --stdout --no-copy`). What is left is the DOM
//    description: text, card context, selector path, styles, html, the framework component's
//    name. Its prompt holds the spec inline.
// C  the recording itself, reached as a plugin user's agent reaches it: through the pointcast MCP
//    server (packages/cli/dist/index.js mcp --repo <app> --dir <sessions> --no-handoff), whose
//    get_session("latest") resolves the code locations in the app's source. The prompt only says
//    where the request is (see C_REQUEST); <dir>/<app>/<task>/C/mcp.json is the --mcp-config of
//    that one run, and get-session.preview.md is what `pointcast process --repo` renders for it
//    (the same renderer and resolver the MCP tool uses), for the record.
// A  is written by dev/eval/typed/write-a.mjs (it costs agent calls).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { APPS_DIR, EVAL_DIR, REPO_ROOT } from "../lib/apps.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string" }, "django-dir": { type: "string", default: process.env.EVAL_DJANGO_DIR } } });
if (!values.out) throw new Error("--out <dir> is required");
const OUT = path.resolve(values.out);
const CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");
if (!existsSync(CLI)) throw new Error(`build the CLI first (pnpm --filter pointcast build): ${CLI}`);
const config = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const template = readFileSync(path.join(EVAL_DIR, "prompt.md"), "utf8");

/** Variant C's request: where the plugin's /pointcast skill sends the agent, in its own words (steps 1, 3, 4). */
export const C_REQUEST = `The user recorded this request with pointcast. Get it with the pointcast MCP tool \`get_session\` (id "latest"), then follow the spec's own rules, written at its top. Each request quotes what the user wrote about the element they pointed at. Find each element through its code pointer before searching:
- \`text at:\` or \`data at:\` is the line that holds that element's text or data: usually the line to change.
- \`used at:\`/\`code:\` is where that instance is written, innermost first; a component marked shared renders every instance: change the instance, not the shared component, unless the request is about all of them.
- Search the codebase only when the spec gives no pointer, and then use its \`find:\` hints.`;

export function appDirOf(app) {
  if (config.apps[app].server === "django") {
    if (!values["django-dir"]) throw new Error("--django-dir is required for locallibrary");
    return path.resolve(values["django-dir"]);
  }
  return path.join(APPS_DIR, app);
}

const hashes = [];
for (const task of config.tasks) {
  const recorded = path.join(OUT, "sessions", task.app, task.id);
  const sessionId = readdirSync(recorded, { withFileTypes: true }).find((d) => d.isDirectory())?.name;
  if (!sessionId) throw new Error(`${task.app}/${task.id}: not recorded`);
  const taskDir = path.join(OUT, task.app, task.id);
  const repo = appDirOf(task.app);

  // ---- B: strip the code pointer and render.
  const bSessions = path.join(OUT, "work", "B", task.app, task.id);
  rmSync(bSessions, { recursive: true, force: true });
  cpSync(path.join(recorded, sessionId), path.join(bSessions, sessionId), { recursive: true });
  const sessionFile = path.join(bSessions, sessionId, "session.json");
  const session = JSON.parse(readFileSync(sessionFile, "utf8"));
  for (const ev of session.events) stripCode(ev.element);
  writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
  rmSync(path.join(bSessions, sessionId, "session.md"), { force: true });
  // cwd = the sessions copy: nothing of the app is readable from there, so nothing resolves.
  const bSpec = cli(["process", path.join(bSessions, sessionId), "--stdout", "--no-copy"], bSessions);
  if (/used at:|text at:|data at:|template:|within:|code:/.test(bSpec)) throw new Error(`${task.id}: B still has code lines`);
  writePrompt(path.join(taskDir, "B"), bSpec);

  // ---- C: one sessions folder per task (so "latest" is this recording), and its MCP config.
  const cSessions = path.join(OUT, "work", "C", task.app, task.id);
  rmSync(cSessions, { recursive: true, force: true });
  cpSync(path.join(recorded, sessionId), path.join(cSessions, sessionId), { recursive: true });
  const cDir = path.join(taskDir, "C");
  mkdirSync(cDir, { recursive: true });
  const mcp = { mcpServers: { pointcast: { command: process.execPath, args: [CLI, "mcp", "--repo", repo, "--dir", cSessions, "--no-handoff"] } } };
  writeFileSync(path.join(cDir, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`);
  // What get_session will return, rendered by the same resolver (for the record, not given to the agent).
  const preview = cli(["process", path.join(cSessions, sessionId), "--repo", repo, "--stdout", "--no-copy"], cSessions);
  writeFileSync(path.join(cDir, "get-session.preview.md"), preview);
  writePrompt(cDir, C_REQUEST);
}
writeFileSync(path.join(OUT, "prompts.sha256"), `${hashes.join("\n")}\n`);
console.log(`prepared B and C for ${config.tasks.length} tasks; hashes in ${path.join(OUT, "prompts.sha256")}`);

function stripCode(element) {
  delete element.renderedBy;
  delete element.resolved;
  if (element.component) {
    if (element.component.framework === "django") delete element.component;
    else for (const k of ["file", "line", "column", "loc", "snippet"]) delete element.component[k];
  }
}

function writePrompt(dir, request) {
  mkdirSync(dir, { recursive: true });
  const prompt = template.replace("{{REQUEST}}", request.trim());
  writeFileSync(path.join(dir, "prompt.md"), prompt);
  hashes.push(`${createHash("sha256").update(prompt).digest("hex")}  ${path.relative(OUT, path.join(dir, "prompt.md")).replace(/\\/g, "/")}`);
}

function cli(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, POINTCAST_HANDOFF: "off" } });
  if (res.status !== 0 || !res.stdout.trim()) throw new Error(`pointcast ${args.join(" ")} failed:\n${res.stderr}`);
  return res.stdout;
}
