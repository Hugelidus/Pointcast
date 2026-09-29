/** Shared helpers: Playwright from the main checkout's node_modules, a tiny localhost server, low priority. */
import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); // children inherit BELOW_NORMAL on Windows

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..");
export const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
/** Persistent profile: the on-device language pack is per install, but keep one profile across runs anyway. */
export const PROFILE = process.env.SPEECH_PROFILE ?? path.join(os.tmpdir(), "pc-speech-profile");

function findRequireRoot() {
  // Worktrees have no node_modules: walk up until one has @playwright/test.
  let dir = REPO;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "node_modules", "@playwright", "test"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("no node_modules/@playwright/test found above the repo");
}
const require = createRequire(path.join(findRequireRoot(), "package.json"));
export const { chromium } = require("@playwright/test");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wav": "audio/wav" };

/** Serves this folder at / and dev/fixtures/audio at /audio/. */
export function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const file = url.pathname.startsWith("/audio/")
        ? path.join(REPO, "dev", "fixtures", "audio", path.basename(url.pathname))
        : path.join(HERE, path.basename(url.pathname === "/" ? "page.html" : url.pathname));
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    });
    server.listen(Number(process.env.PORT ?? 47811), "127.0.0.1", () => resolve({ server, origin: `http://localhost:${server.address().port}` }));
  });
}

/** Fake mic fed from a fixture WAV, played once; nothing reaches the speakers. */
export function fakeAudioArgs(wav) {
  const file = path.isAbsolute(wav) ? wav : path.join(REPO, "dev", "fixtures", "audio", wav);
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${file}%noloop`,
    "--mute-audio",
  ];
}
