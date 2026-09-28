import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, HANDOFF_HELLO_PATH, extensionOrigin } from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "../version";

/**
 * The real `pointcast mcp` process, as an agent starts it: the receiver comes up with the MCP
 * server, answers the extension, and goes away with it when stdin ends. The SDK's stdio transport
 * ignores stdin's end, so this is the test that a listener cannot keep a dead server alive.
 * POINTCAST_HANDOFF_PORT=0 on every run, so no test binds 20547, the port a real extension uses.
 */

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STARTUP_TIMEOUT_MS = 20_000;

interface McpProcess {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<number | null>;
}

function startMcp(args: readonly string[], dir: string): McpProcess {
  // Nothing from the developer's own setup (POINTCAST_DIR, a real handoff port) may leak in.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(POINTCAST_|CLAUDE_PROJECT_DIR$)/i.test(name)),
  );
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "mcp", "--dir", dir, ...args], {
    cwd: CLI_ROOT,
    env: { ...env, POINTCAST_HANDOFF_PORT: "0" },
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

async function until<T>(value: () => T | undefined, what: string, timeoutMs = STARTUP_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = value();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function hello(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: HANDOFF_HELLO_PATH,
        headers: { Origin: extensionOrigin(EXTENSION_ID), "X-Pointcast-Handoff": "1" },
        agent: false,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function connectionRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED"));
  });
}

describe("pointcast mcp process", () => {
  let dir: string;
  let running: McpProcess[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pointcast-mcp-lifecycle-"));
    running = [];
  });
  afterEach(() => {
    for (const mcp of running) mcp.child.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("receives recordings while it runs, and exits when stdin ends, port closed and stdout untouched", async () => {
    const mcp = startMcp([], dir);
    running.push(mcp);
    const port = Number(
      await until(() => /receiving recordings from the extension on 127\.0\.0\.1:(\d+)/.exec(mcp.stderr())?.[1], "the receiver"),
    );

    const answer = await hello(port);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ app: "pointcast", protocol: 1, version: VERSION });

    mcp.child.stdin.end();
    const exit = await Promise.race([mcp.exited, new Promise<"still running">((r) => setTimeout(() => r("still running"), 3_000))]);
    expect(exit).toBe(0);
    expect(await connectionRefused(port)).toBe(true);
    expect(mcp.stdout()).toBe("");
  }, 30_000);

  it("does not receive with --no-handoff, and still serves the tools", async () => {
    const mcp = startMcp(["--no-handoff"], dir);
    running.push(mcp);
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
    };
    mcp.child.stdin.write(`${JSON.stringify(initialize)}\n`);
    await until(() => (mcp.stdout().includes('"id":1') ? true : undefined), "the initialize answer");

    mcp.child.stdin.end();
    expect(await mcp.exited).toBe(0);
    expect(mcp.stderr()).not.toContain("receiving");
  }, 30_000);
});
