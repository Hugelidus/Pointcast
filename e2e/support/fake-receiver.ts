import { createServer, type IncomingHttpHeaders } from "node:http";

export interface ReceivedRequest {
  method: string;
  url: string;
  /** As Node gives them: lower-case names. */
  headers: IncomingHttpHeaders;
}

export interface FakeReceiver {
  /** Every request, in order, including any a browser would send first (a CORS preflight). */
  requests: ReceivedRequest[];
  close(): Promise<void>;
}

/**
 * A pointcast MCP server that says hello like the real one (protocol 1) and then refuses every
 * upload with `upload` as the status and a pointcast error answer, so a test sees the refusal
 * path of the extension's handoff (offscreen/handoff.ts) and exactly what the browser sent.
 * Anything else gets an empty 404.
 */
export async function startFakeReceiver({ port, upload }: { port: number; upload: number }): Promise<FakeReceiver> {
  const requests: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
    const send = (status: number, body?: object) => {
      response.writeHead(status, {
        Connection: "close",
        "Cache-Control": "no-store",
        ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      });
      response.end(body ? JSON.stringify(body) : undefined);
    };
    // Answer once the whole body is in, as the real receiver does: an answer while Chrome is
    // still sending can reach it as a reset connection instead of the refusal.
    request.resume();
    request.on("end", () => {
      if (request.method !== "POST") return send(404);
      if (request.url === "/pointcast/v1/hello") return send(200, { app: "pointcast", protocol: 1, version: "test" });
      if (request.url?.startsWith("/pointcast/v1/sessions/")) {
        return send(upload, { app: "pointcast", error: "write-failed", message: "disk full (test)" });
      }
      send(404);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
