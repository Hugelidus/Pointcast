import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { request } from "node:http";
import path from "node:path";
import {
  EXTENSION_ID,
  HANDOFF_HEADER,
  HANDOFF_HEADER_VALUE,
  HANDOFF_HELLO_PATH,
  HANDOFF_HOST,
  extensionOrigin,
  parseErrorAnswer,
  parseHelloAnswer,
} from "@pointcast/core";

/**
 * The parts of `pointcast doctor` that touch the machine: the loopback port, the module
 * resolver, PATH and npm. Each is a small default that doctor.ts receives as a dependency, so
 * the checks are unit-tested with fakes and nothing here ever runs in a test by accident.
 */

/** What answered the extension's hello on the handoff port. */
export type ReceiverProbe =
  | { kind: "pointcast"; version: string; protocol: number }
  /** Something answered, but not a pointcast hello (or not within the timeout). */
  | { kind: "other"; detail: string }
  /** Connection refused: nothing listens there. */
  | { kind: "nobody" };

/** The most of an answer that is read: a hello is under 100 bytes. */
const MAX_ANSWER_BYTES = 4096;

/**
 * Says hello exactly as the official extension does (POST, its Origin, the handoff header, an
 * empty body), so a pointcast MCP server answers with its version. Only the hello: no recording
 * is ever sent. node:http rather than fetch, because it sends the Origin header as given.
 */
export function probeReceiver(port: number, timeoutMs = 1_000): Promise<ReceiverProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ReceiverProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(result);
    };
    const req = request(
      {
        host: HANDOFF_HOST,
        port,
        path: HANDOFF_HELLO_PATH,
        method: "POST",
        headers: {
          Origin: extensionOrigin(EXTENSION_ID),
          [HANDOFF_HEADER]: HANDOFF_HEADER_VALUE,
          "Content-Length": 0,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) done({ kind: "other", detail: "it answered with something too long for a pointcast hello" });
          else chunks.push(chunk);
        });
        res.on("end", () => done(classifyAnswer(res.statusCode ?? 0, Buffer.concat(chunks).toString("utf8"))));
        res.on("error", () => done({ kind: "other", detail: "its answer broke off" }));
      },
    );
    const timer = setTimeout(
      () => done({ kind: "other", detail: `no answer within ${timeoutMs / 1000} s` }),
      timeoutMs,
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      done(error.code === "ECONNREFUSED" ? { kind: "nobody" } : { kind: "other", detail: error.code ?? error.message });
    });
    req.end();
  });
}

/** Exported for tests: what an HTTP answer to the hello means. */
export function classifyAnswer(status: number, body: string): ReceiverProbe {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  if (status === 200) {
    const hello = parseHelloAnswer(json);
    if (hello) return { kind: "pointcast", version: hello.version, protocol: hello.protocol };
  }
  const error = parseErrorAnswer(json);
  if (error) return { kind: "other", detail: `a pointcast server refused the hello: ${error.message}` };
  return { kind: "other", detail: `it answered HTTP ${status}, not a pointcast hello` };
}

/**
 * Whether `import("@huggingface/transformers")` would find the package from the CLI's own
 * location, the way the local engine loads it (transcribe/index.ts). Only resolved, never
 * loaded: loading it starts ONNX Runtime.
 */
export function transformersInstalled(): boolean {
  try {
    // Node 22's import.meta.resolve is synchronous and follows the same "import" conditions.
    if (typeof import.meta.resolve === "function") {
      import.meta.resolve("@huggingface/transformers");
      return true;
    }
    createRequire(import.meta.url).resolve("@huggingface/transformers");
    return true;
  } catch {
    return false;
  }
}

/** Whether an executable named `command` is on PATH, found without running it. */
export function onPath(command: string, env: Record<string, string | undefined> = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const file = path.join(dir, command);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      // Not there, or not executable: keep looking.
    }
  }
  return false;
}

/** The `latest` dist-tag of pointcast on npm, or undefined when npm could not be asked. */
export async function latestNpmVersion(timeoutMs = 5_000): Promise<string | undefined> {
  try {
    const response = await fetch("https://registry.npmjs.org/pointcast/latest", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
