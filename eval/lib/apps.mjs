// Shared paths and the dev-server helper used by setup, the scenario check and the recorder.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REPO_ROOT = path.dirname(EVAL_DIR);
export const APPS_DIR = path.join(EVAL_DIR, ".apps");
export const RUNS_DIR = path.join(EVAL_DIR, ".runs");
export const SCENARIOS_DIR = path.join(EVAL_DIR, "scenarios");

/**
 * @typedef {{ name: string, stack: string, repo: string, commit: string, license: string, port: number }} App
 */

/** @returns {App[]} */
export function readApps() {
  return JSON.parse(readFileSync(path.join(EVAL_DIR, "apps.json"), "utf8"));
}

/** @param {string} name */
export function appByName(name) {
  const app = readApps().find((a) => a.name === name);
  if (!app) throw new Error(`unknown app "${name}" (see eval/apps.json)`);
  return app;
}

export const appDir = (/** @type {string} */ name) => path.join(APPS_DIR, name);

/** Reads eval/scenarios/<name>/scenario.json. */
export function readScenario(/** @type {string} */ name) {
  return JSON.parse(readFileSync(path.join(SCENARIOS_DIR, name, "scenario.json"), "utf8"));
}

/**
 * Starts the app's Vite dev server on its fixed port and resolves once it answers.
 * Vite is run directly (not through "pnpm dev") so we control host/port, and BROWSER=none
 * makes sure no browser window ever opens on the user's desktop.
 * @param {App} app
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
export async function startDevServer(app) {
  const cwd = appDir(app.name);
  const vite = path.join(cwd, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) throw new Error(`${app.name} is not installed: run "node eval/setup-apps.mjs"`);
  const url = `http://127.0.0.1:${app.port}`;
  const child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(app.port), "--strictPort"], {
    cwd,
    env: { ...process.env, BROWSER: "none", NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  lowerPriority(child.pid);
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const stop = () => killTree(child.pid);
  try {
    await waitForHttp(url, 60_000, () => child.exitCode !== null);
  } catch (error) {
    stop();
    throw new Error(`${app.name}: dev server did not answer on ${url}: ${error.message}\n${log.slice(-2000)}`);
  }
  return { url, stop };
}

/** @param {string} url */
async function waitForHttp(url, timeoutMs, exited = () => false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("process exited");
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out");
}

/** The user works at this machine: background work runs below normal priority. */
export function lowerPriority(/** @type {number | undefined} */ pid) {
  if (pid === undefined) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not fatal: the process just runs at normal priority.
  }
}

/** Vite spawns esbuild; on Windows child.kill() would leave it running, so kill the whole tree. */
export function killTree(/** @type {number | undefined} */ pid) {
  if (pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}
