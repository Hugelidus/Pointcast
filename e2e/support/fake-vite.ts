import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { REPO_ROOT } from "./paths";

const PLAYGROUND = path.join(REPO_ROOT, "playground");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

export interface FakeVite {
  origin: string;
  /** Every request path (with its query), in order. */
  requests: string[];
  close(): Promise<void>;
}

/**
 * Just enough of a Vite dev server for route 3 (offscreen/dev-server.ts): the playground pages
 * are the app; /@vite/client answers as Vite's client does (how the extension recognizes Vite);
 * `/<file>?raw` answers as Vite does for a file inside its root, `export default "<contents>"`,
 * for the project files in `sources` (project-relative path -> contents); anything else is a 404.
 * No CORS headers: the extension reads with its host permissions, which make them unnecessary.
 */
export async function startFakeVite(port: number, sources: Record<string, string>): Promise<FakeVite> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(`${url.pathname}${url.search}`);
    const send = (status: number, type: string, body: string) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    };
    const file = decodeURI(url.pathname).slice(1);
    if (url.pathname === "/@vite/client") return send(200, "text/javascript", "console.debug('[vite] connected.');");
    if (url.search === "?raw") {
      const source = sources[file];
      return source === undefined ? send(404, "text/plain", "Not found") : send(200, "text/javascript", `export default ${JSON.stringify(source)}`);
    }
    const onDisk = path.join(PLAYGROUND, path.normalize(file));
    if (!onDisk.startsWith(PLAYGROUND + path.sep)) return send(404, "text/plain", "Not found");
    readFile(onDisk, "utf8").then(
      (text) => send(200, TYPES[path.extname(onDisk)] ?? "application/octet-stream", text),
      () => send(404, "text/plain", "Not found"),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // The browser keeps its connections alive; close() alone would wait for them forever.
        server.closeAllConnections();
      }),
  };
}
