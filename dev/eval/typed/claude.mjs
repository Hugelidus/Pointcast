// Runs `claude -p` headless (the harness settings of dev/eval/run.mjs) with a cost ledger and a
// stop-loss: every run's total_cost_usd, as the CLI reports it, is appended to <out>/ledger.jsonl,
// and no new run starts once the ledger reaches the stop-loss.
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Hard stop agreed with the owner: 15 USD; new runs stop a little before it. */
export const STOP_LOSS_USD = 15;
export const STOP_BEFORE_USD = 14;

export function spentUsd(outDir) {
  const file = path.join(outDir, "ledger.jsonl");
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + (JSON.parse(line).costUsd ?? 0), 0);
}

export function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const c of [path.join(dir, "claude.exe"), path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]) if (existsSync(c)) return c;
  }
  throw new Error("claude not found on PATH (set CLAUDE_BIN)");
}

/** This process may itself run inside Claude Code: drop that session's variables. */
export const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|AI_AGENT$|BAGGAGE$)/.test(k)));

/**
 * One `claude -p` run with stream-json output (every event saved to streamFile when given).
 * Returns the final `result` event (the object --output-format json prints) or undefined.
 */
export async function runClaude({ args, prompt, cwd, streamFile, outDir, label, env = {} }) {
  if (spentUsd(outDir) >= STOP_BEFORE_USD) throw new Error(`stop-loss: ${spentUsd(outDir).toFixed(2)} USD spent, not starting ${label}`);
  const started = Date.now();
  const { code, stderr, result } = await new Promise((resolve) => {
    const child = spawn(findClaude(), args, { cwd, env: { ...cleanEnv(), ...env }, windowsHide: true });
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // runs at normal priority
    }
    const ws = streamFile ? createWriteStream(streamFile) : undefined;
    let buf = "";
    let err = "";
    let last;
    const take = (line) => {
      if (!line.trim()) return;
      try {
        const e = JSON.parse(line);
        if (e.type === "result") last = e;
      } catch {
        // not JSON
      }
    };
    child.stdout.on("data", (d) => {
      ws?.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        take(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      take(buf);
      ws?.end();
      resolve({ code: c, stderr: err, result: last });
    });
    child.stdin.end(prompt);
  });
  const wallMs = Date.now() - started;
  appendFileSync(path.join(outDir, "ledger.jsonl"), `${JSON.stringify({ label, costUsd: result?.total_cost_usd ?? 0, wallMs, at: new Date().toISOString(), ok: Boolean(result && !result.is_error) })}\n`);
  return { result, code, stderr, wallMs };
}
