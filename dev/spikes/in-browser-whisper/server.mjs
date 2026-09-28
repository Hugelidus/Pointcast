/**
 * Dependency-free static server for the in-browser Whisper spike (node:http only).
 *
 *   node dev/spikes/in-browser-whisper/server.mjs            # ports 5531 (isolated) and 5532 (not)
 *   node dev/spikes/in-browser-whisper/server.mjs --port 5541
 *
 * Then open http://localhost:5531/ in Chrome. Port P sends COOP same-origin + COEP require-corp,
 * so the page is crossOriginIsolated (SharedArrayBuffer, multi-threaded WASM). Port P+1 sends
 * neither, to show what happens without isolation (ONNX Runtime falls back to one thread).
 *
 * Only four URL roots are served, all read-only and bound to 127.0.0.1:
 *   /spike/      this folder (the page)
 *   /vendor/transformers/  @huggingface/transformers/dist, resolved from packages/cli like Node does
 *   /vendor/ort/           onnxruntime-web/dist, resolved from the transformers package itself
 *   /fixtures/audio/       the repo's audio fixtures and their SAPI ground truth
 * No CDN is involved: MV3 forbids remotely hosted code, so the spike loads code the same way an
 * extension bundle would (local files). Model weights still come from huggingface.co (data).
 */
import { createServer } from "node:http";
import { createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** Same resolution Node does for `import "@huggingface/transformers"` from packages/cli. */
export function resolveVendorDirs() {
  const transformersPkg = realpathSync(path.join(REPO_ROOT, "packages", "cli", "node_modules", "@huggingface", "transformers"));
  // pnpm puts a package's own dependencies next to it: .pnpm/<pkg>/node_modules/<dep>.
  const ortPkg = realpathSync(path.join(transformersPkg, "..", "..", "onnxruntime-web"));
  return {
    transformers: path.join(transformersPkg, "dist"),
    ort: path.join(ortPkg, "dist"),
    transformersVersion: JSON.parse(readText(path.join(transformersPkg, "package.json"))).version,
    ortVersion: JSON.parse(readText(path.join(ortPkg, "package.json"))).version,
  };
}

function readText(file) {
  return readFileSync(file, "utf8");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function routes() {
  const vendor = resolveVendorDirs();
  return {
    vendor,
    roots: [
      ["/spike/", HERE],
      ["/vendor/transformers/", vendor.transformers],
      ["/vendor/ort/", vendor.ort],
      ["/fixtures/audio/", path.join(REPO_ROOT, "dev", "fixtures", "audio")],
    ],
  };
}

/** Starts one server. `isolated` adds the COOP/COEP headers that make the page crossOriginIsolated. */
export function startServer({ port, isolated, log = false }) {
  const { roots } = routes();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(302, { Location: "/spike/index.html" });
      res.end();
      return;
    }
    const root = roots.find(([prefix]) => url.pathname.startsWith(prefix));
    if (!root) return notFound(res);
    const [prefix, dir] = root;
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html";
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== dir) return notFound(res); // no ../ escapes
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return notFound(res);
    }
    if (!stat.isFile()) return notFound(res);
    const headers = {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      // Every run re-reads code from disk; model weights are cached by the page (Cache API).
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (isolated) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    if (log) console.log(`${req.method} ${url.pathname} ${stat.size}`);
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 5531;
  const { vendor } = routes();
  await startServer({ port, isolated: true, log: process.argv.includes("--log") });
  await startServer({ port: port + 1, isolated: false, log: process.argv.includes("--log") });
  console.log(`transformers.js ${vendor.transformersVersion} from ${vendor.transformers}`);
  console.log(`onnxruntime-web ${vendor.ortVersion} from ${vendor.ort}`);
  console.log(`crossOriginIsolated: http://localhost:${port}/`);
  console.log(`NOT isolated:        http://localhost:${port + 1}/`);
}
