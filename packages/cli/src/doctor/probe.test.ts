import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_EXTENSION_IDS } from "@pointcast/core";
import { startHandoffReceiver } from "../handoff/receiver";
import { classifyAnswer, onPath, probeReceiver } from "./probe";

// Every server here listens on a port the OS picks (0), never on the real handoff port 20547.
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

describe("probeReceiver", () => {
  it("says hello like the official extension and reads the version", async () => {
    let seen: { method?: string; url?: string; headers?: IncomingHttpHeaders; body?: string } = {};
    const port = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen = { method: req.method, url: req.url, headers: req.headers, body };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ app: "pointcast", protocol: 1, version: "0.2.1" }));
      });
    });
    expect(await probeReceiver(port)).toEqual({ kind: "pointcast", version: "0.2.1", protocol: 1 });
    expect(seen).toMatchObject({ method: "POST", url: "/pointcast/v1/hello", body: "" });
    expect(seen.headers).toMatchObject({
      host: `127.0.0.1:${port}`,
      origin: "chrome-extension://hliijcklkpbddgjhkifjeggidghbbboa",
      "x-pointcast-handoff": "1",
    });
  });

  it("gets the version from a real pointcast receiver, and sends it no recording", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "pointcast-doctor-"));
    const logs: string[] = [];
    const receiver = startHandoffReceiver({
      base,
      port: 0,
      allowedExtensionIds: new Set(OFFICIAL_EXTENSION_IDS),
      version: "9.9.9",
      log: (message) => logs.push(message),
    });
    try {
      const port = await receiver.listening();
      expect(await probeReceiver(port)).toEqual({ kind: "pointcast", version: "9.9.9", protocol: 1 });
      expect(logs.filter((line) => line.includes("stored"))).toEqual([]);
    } finally {
      await receiver.close();
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("reports another program when the answer is not a pointcast hello", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(404);
      res.end("<html>not found</html>");
    });
    expect(await probeReceiver(port)).toEqual({ kind: "other", detail: "it answered HTTP 404, not a pointcast hello" });
  });

  it("reports another program when nothing answers in time", async () => {
    const port = await listen(() => {
      // Accepts the connection, never answers.
    });
    expect(await probeReceiver(port, 100)).toEqual({ kind: "other", detail: "no answer within 0.1 s" });
  });

  it("reports nobody when the connection is refused", async () => {
    // A port that was free a moment ago: bind it, then close it.
    const port = await listen(() => {});
    await new Promise((resolve) => servers.pop()!.close(resolve));
    expect(await probeReceiver(port)).toEqual({ kind: "nobody" });
  });
});

describe("classifyAnswer", () => {
  it("accepts only a well-formed hello", () => {
    expect(classifyAnswer(200, '{"app":"pointcast","protocol":1,"version":"0.2.0"}')).toEqual({ kind: "pointcast", version: "0.2.0", protocol: 1 });
    expect(classifyAnswer(200, '{"app":"other","protocol":1,"version":"1"}')).toMatchObject({ kind: "other" });
    expect(classifyAnswer(200, "not json")).toMatchObject({ kind: "other" });
    expect(classifyAnswer(403, '{"app":"pointcast","error":"unknown-extension","message":"no"}')).toEqual({
      kind: "other",
      detail: "a pointcast server refused the hello: no",
    });
  });
});

describe("onPath", () => {
  it("finds an executable file on PATH without running it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pointcast-doctor-"));
    try {
      const bin = path.join(dir, "bin");
      mkdirSync(bin);
      mkdirSync(path.join(bin, "a-folder"));
      writeFileSync(path.join(bin, "xclip"), "#!/bin/sh\nexit 1\n");
      chmodSync(path.join(bin, "xclip"), 0o755);
      const env = { PATH: ["", path.join(dir, "missing"), bin].join(path.delimiter) };
      expect(onPath("xclip", env)).toBe(true);
      expect(onPath("wl-copy", env)).toBe(false);
      expect(onPath("a-folder", env)).toBe(false);
      expect(onPath("xclip", {})).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
