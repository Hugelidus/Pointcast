import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { CommandStep } from "./plan";

/**
 * The parts of `pointcast setup` that touch the machine: PATH, child processes and the terminal.
 * run.ts receives them as dependencies, so the tests never start an agent or wait for a key.
 */

export interface RunResult {
  code: number;
  /** The command's output, when it was captured (--json); empty when it went to the terminal. */
  output: string;
}

export type CommandRunner = (step: CommandStep, options: { capture: boolean }) => Promise<RunResult>;

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `command` is on PATH, without running it. On Windows, only names with a PATHEXT extension
 * count (`claude.cmd`, `cursor.cmd`, `codex.exe`): npm also leaves an extensionless shell script
 * next to each shim, which Windows cannot run.
 */
export function findOnPath(
  command: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  // process.env is case-insensitive on Windows; a copy of it is not.
  const pathVar = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of pathVar.split(platform === "win32" ? ";" : path.delimiter)) {
    if (dir === "") continue;
    for (const extension of extensions) {
      const file = path.join(dir, command + extension.toLowerCase());
      if (isExecutableFile(file, platform)) return file;
    }
  }
  return undefined;
}

/** Only fixed tokens from plan.ts: safe to hand to cmd.exe unquoted. */
const SAFE_TOKEN = /^[\w@.:/-]+$/;

/**
 * How to spawn a step. On Windows the agents are `.cmd` shims, which Node spawns only through a
 * shell; the command line is then built from tokens that need no quoting, and anything else is
 * refused rather than escaped.
 */
export function spawnSpec(step: CommandStep, platform: NodeJS.Platform): { file: string; args: string[]; shell: boolean } {
  if (platform !== "win32") return { file: step.command, args: step.args, shell: false };
  for (const token of [step.command, ...step.args]) {
    if (!SAFE_TOKEN.test(token)) throw new Error(`refusing to pass "${token}" through the Windows shell`);
  }
  return { file: [step.command, ...step.args].join(" "), args: [], shell: true };
}

export const runCommand: CommandRunner = (step, { capture }) =>
  new Promise((resolve) => {
    let spec;
    try {
      spec = spawnSpec(step, process.platform);
    } catch (error) {
      resolve({ code: 1, output: (error as Error).message });
      return;
    }
    const child = spawn(spec.file, spec.args, {
      shell: spec.shell,
      windowsHide: true,
      // On a terminal the agent's own output and questions reach the user; with --json, stdout
      // must carry only the report.
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4_000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (error) => resolve({ code: 127, output: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, output: output.trim() }));
  });

/** y/N on the terminal, asked on stderr; anything but y or yes is a no. */
export async function confirmOnTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^\s*y(es)?\s*$/i.test(answer);
  } finally {
    rl.close();
  }
}
