import { createRequire } from "node:module";
import { connect } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./paths";

const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
/** tsx compiles the CLI on the fly: a few seconds on a busy machine. */
const STARTUP_TIMEOUT_MS = 20_000;
const EXIT_TIMEOUT_MS = 5_000;

/**
 * The part of the MCP SDK's Client the suite uses. Declared here because the SDK is a dependency
 * of packages/cli only: its types do not resolve from dev/e2e/, and the repo root does not depend on it.
 */
export interface McpClient {
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: { type: string; text?: string }[];
    isError?: boolean;
  }>;
  close(): Promise<void>;
}

interface ClientModule {
  Client: new (info: { name: string; version: string }) => McpClient & { connect(transport: unknown): Promise<void> };
}
interface StdioModule {
  StdioClientTransport: new (params: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    stderr: "pipe";
  }) => { stderr: NodeJS.ReadableStream | null };
}

export interface PointcastMcp {
  client: McpClient;
  /** The server's stderr so far, one entry per line: the receiver logs there (stdout is the MCP channel). */
  stderr: string[];
  /** Ends the server as an agent does (stdin closes), and waits until the port refuses connections. */
  close(): Promise<void>;
}

/**
 * The real `pointcast mcp` from source, connected like an agent connects to it, with its handoff
 * receiver on `port` (POINTCAST_HANDOFF_PORT, the CLI's test hook) and `dir` as its sessions
 * folder. The SDK's own stdio transport starts it: hidden (windowsHide) and with a minimal
 * environment, so nothing from the developer's setup (POINTCAST_DIR, a real handoff port) leaks
 * in. CLAUDE_PROJECT_DIR is the temporary folder too, so code lookups never read this repository.
 */
export async function startPointcastMcp({ dir, port }: { dir: string; port: number }): Promise<PointcastMcp> {
  const fromCli = createRequire(path.join(CLI_DIR, "package.json"));
  const load = <T>(specifier: string) => import(pathToFileURL(fromCli.resolve(specifier)).href) as Promise<T>;
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    load<ClientModule>("@modelcontextprotocol/sdk/client/index.js"),
    load<StdioModule>("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts", "mcp", "--dir", dir],
    cwd: CLI_DIR,
    env: { POINTCAST_HANDOFF_PORT: String(port), CLAUDE_PROJECT_DIR: dir },
    stderr: "pipe",
  });
  const stderr: string[] = [];
  const receiving = new Promise<void>((resolve, reject) => {
    let partial = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      const lines = (partial + chunk.toString("utf8")).split(/\r?\n/);
      partial = lines.pop() ?? "";
      stderr.push(...lines);
      if (lines.some((line) => line.includes(`receiving recordings from the extension on 127.0.0.1:${port}`))) resolve();
    });
    transport.stderr?.on("end", () => reject(new Error(`pointcast mcp exited before receiving:\n${stderr.join("\n")}`)));
  });
  // Awaited below; this only keeps an early exit from counting as an unhandled rejection meanwhile.
  receiving.catch(() => undefined);

  const client = new Client({ name: "pointcast-e2e", version: "0.0.0" });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      // stdin ends; the SDK kills the process if it has not exited 2 s later.
      await client.close();
      const deadline = Date.now() + EXIT_TIMEOUT_MS;
      while (!(await refuses(port))) {
        if (Date.now() > deadline) throw new Error(`127.0.0.1:${port} still accepts connections after pointcast mcp exited`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })());

  try {
    await client.connect(transport);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`pointcast mcp did not receive on port ${port} within ${STARTUP_TIMEOUT_MS} ms:\n${stderr.join("\n")}`)),
        STARTUP_TIMEOUT_MS,
      );
    });
    await Promise.race([receiving, timeout]).finally(() => clearTimeout(timer));
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return { client, stderr, close };
}

/** True once nothing listens on 127.0.0.1:`port`. */
function refuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED"));
  });
}
