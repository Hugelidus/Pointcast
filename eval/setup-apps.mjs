// Clones each app of eval/apps.json at its pinned commit, installs it, starts its dev server and
// checks it headlessly: the page renders, and every element the scenario points at is there.
//
//   node eval/setup-apps.mjs [app ...]
//
// Installs use pnpm with --ignore-workspace: eval/.apps lives inside this repo, and without the
// flag pnpm would treat each app as part of the pointcast workspace. pnpm's store hard-links
// packages the apps share (vite, tailwind…), which keeps disk use down.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APPS_DIR, RUNS_DIR, SCENARIOS_DIR, appDir, readApps, readScenario, startDevServer } from "./lib/apps.mjs";
import { readNarration, scheduleGestures } from "./lib/narration.mjs";

const wanted = process.argv.slice(2);
const apps = readApps().filter((a) => wanted.length === 0 || wanted.includes(a.name));
mkdirSync(APPS_DIR, { recursive: true });
let failed = false;

for (const app of apps) {
  console.log(`\n== ${app.name} (${app.stack})`);
  try {
    cloneAtCommit(app);
    install(app);
    await check(app);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${app.name}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);

/** A shallow fetch of exactly the pinned commit: reproducible and small. */
function cloneAtCommit(app) {
  const dir = appDir(app.name);
  if (!existsSync(path.join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    run("git", ["init", "-q"], dir);
    run("git", ["remote", "add", "origin", app.repo], dir);
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  if (head === app.commit) return;
  run("git", ["fetch", "-q", "--depth", "1", "origin", app.commit], dir);
  run("git", ["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"], dir);
}

function install(app) {
  const dir = appDir(app.name);
  if (existsSync(path.join(dir, "node_modules", "vite"))) return;
  // HUSKY=0: some apps install git hooks in "prepare"; they are not ours to install.
  // package-manager-strict=false: vuestic-admin pins yarn 4; we convert its yarn.lock instead.
  // CI=true: pnpm never stops to ask a question.
  const env = { ...process.env, HUSKY: "0", CI: "true", npm_config_package_manager_strict: "false" };
  const args = ["install", "--frozen-lockfile", "--ignore-workspace"];
  if (!existsSync(path.join(dir, "pnpm-lock.yaml"))) {
    run("pnpm", ["import", "--ignore-workspace"], dir, env);
    // A yarn/npm app may import packages it never declared (vuestic-admin uses @floating-ui/dom),
    // which only works with their flat node_modules; hoisting reproduces that layout.
    args.push("--shamefully-hoist");
  }
  run("pnpm", args, dir, env);
}

/** Headless only: no window opens, audio is muted. */
async function check(app) {
  const server = await startDevServer(app);
  const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--mute-audio"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const scenarioFile = path.join(SCENARIOS_DIR, app.name, "scenario.json");
    const scenario = existsSync(scenarioFile) ? readScenario(app.name) : undefined;
    await page.goto(`${server.url}${scenario?.startPath ?? "/"}`, { waitUntil: "networkidle" });
    const count = await page.locator("body *").count();
    if (count < 50) throw new Error(`the page rendered only ${count} elements`);
    mkdirSync(path.join(RUNS_DIR, "setup"), { recursive: true });
    await page.screenshot({ path: path.join(RUNS_DIR, "setup", `${app.name}.png`) });
    console.log(`ok  dev server ${server.url} renders ${count} elements`);
    if (scenario) {
      // Every gesture's word is in the narration (when it was generated) and its element is on screen.
      const narrated = existsSync(path.join(SCENARIOS_DIR, app.name, "narration.words.json"));
      const gestures = narrated ? scheduleGestures(scenario.gestures, readNarration(app.name).words) : scenario.gestures;
      for (const g of gestures) {
        const target = page.locator(g.target).first();
        const visible = await target.isVisible();
        const text = visible ? (await target.innerText()).replace(/\s+/g, " ").slice(0, 50) : "";
        const at = g.atMs === undefined ? "" : ` at ${g.atMs} ms`;
        console.log(`${visible ? "ok " : "BAD"} ${g.gesture} on "${g.word}" #${g.occurrence ?? 1}${at}: ${g.target} «${text}»`);
        if (!visible) failed = true;
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }
}

function run(cmd, args, cwd, env = process.env) {
  // shell: true resolves pnpm.cmd on Windows.
  const res = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}`);
}
