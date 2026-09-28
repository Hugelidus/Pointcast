// Renders the Pointcast demo animation (index.html + timeline.js) to out/pointcast-demo.mp4,
// out/pointcast-demo.gif and one key frame per scene in out/frames/.
//
//   node docs/launch/video/render.mjs                    # everything
//   node docs/launch/video/render.mjs --keys             # only the key frames (quick review)
//   node docs/launch/video/render.mjs --at 2.8,9.1       # only review frames at these instants, in the frames dir
//   node docs/launch/video/render.mjs --frames-dir <dir> # where the frame dump goes (deleted at the end)
//
// The page is served from the repository root on 127.0.0.1 (it reads the logo in dev/scripts/icon/ and the
// real source of dev/examples/react-dashboard) and drawn by headless, muted Chromium at 1600x900, device
// scale 1: window.renderAt(t) draws the instant t, so every frame is exact (t = i / 30). ffmpeg
// (on PATH, or FFMPEG=<path>) encodes the MP4 (H.264, yuv420p, CRF 18, +faststart, no audio) and the
// GIF (800 px wide, 15 fps, two-pass palette), stepping the GIF down until it is under 5 MB.
// Runs at below-normal priority; ffmpeg and Chromium inherit it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.join(HERE, "out");
const FPS = 30;
const [WIDTH, HEIGHT] = [1600, 900];
const GIF_LIMIT = 5 * 1024 * 1024;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ts": "text/plain; charset=utf-8", ".tsx": "text/plain; charset=utf-8" };

/** One review frame per storyboard scene: seconds into the loop. */
const KEYS = {
  "1-title": 0.5,
  "2-first-point": 3.05,
  "3-second-point": 5.95,
  "4-stop": 7.9,
  "5-spec": 10.9,
  "6-code": 14.1,
  "7-end": 16.2,
};

const args = process.argv.slice(2);
const keysOnly = args.includes("--keys") || args.includes("--at");
/** --at 2.8,6.6: extra review frames at these instants, written to the frames directory. */
const extra = args.includes("--at") ? args[args.indexOf("--at") + 1].split(",").map(Number) : [];
const framesDir = path.resolve(args.includes("--frames-dir") ? args[args.indexOf("--frames-dir") + 1] : path.join(os.tmpdir(), "pointcast-video-frames"));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  /* not allowed here: render at normal priority */
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}\n${err}`))));
  });
}

const server = createServer(async (request, response) => {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  if (!file.startsWith(ROOT + path.sep)) return response.writeHead(404).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/docs/launch/video/index.html?capture`;

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
let duration;
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error") console.error(`page: ${m.text()}`); });
  await page.goto(url, { waitUntil: "networkidle" });
  duration = await page.evaluate(() => window.ready);
  const shot = async (t, file) => {
    await page.evaluate((time) => window.renderAt(time), t);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  };

  await mkdir(path.join(OUT, "frames"), { recursive: true });
  for (const [name, t] of Object.entries(KEYS)) await shot(t, path.join(OUT, "frames", `${name}.png`));
  console.log(`key frames: ${Object.keys(KEYS).length} in ${path.relative(ROOT, path.join(OUT, "frames"))}`);
  if (extra.length) await mkdir(framesDir, { recursive: true });
  for (const t of extra) await shot(t, path.join(framesDir, `at-${t.toFixed(2)}.png`));

  if (!keysOnly) {
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const count = Math.round(duration * FPS);
    for (let i = 0; i < count; i++) {
      await shot(i / FPS, path.join(framesDir, `f${String(i).padStart(5, "0")}.png`));
      if (i % 60 === 0) console.log(`frame ${i}/${count}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (!keysOnly) {
  const mp4 = path.join(OUT, "pointcast-demo.mp4");
  await run(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", "f%05d.png", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4], framesDir);
  console.log(`${path.basename(mp4)}: ${((await stat(mp4)).size / 1e6).toFixed(2)} MB, ${duration} s`);

  // GIF: palette from the frames that change (stats_mode=diff), then only the changed rectangles.
  const gif = path.join(OUT, "pointcast-demo.gif");
  const tries = [
    { fps: 15, width: 800, dither: "sierra2_4a" },
    { fps: 15, width: 800, dither: "bayer:bayer_scale=3" },
    { fps: 12, width: 800, dither: "bayer:bayer_scale=3" },
    { fps: 12, width: 720, dither: "bayer:bayer_scale=3" },
    { fps: 10, width: 720, dither: "bayer:bayer_scale=2" },
  ];
  for (const { fps, width, dither } of tries) {
    const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
    const palette = path.join(framesDir, "palette.png");
    await run(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", "f%05d.png", "-vf", `${scale},palettegen=max_colors=256:stats_mode=diff`, palette], framesDir);
    await run(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", "f%05d.png", "-i", palette, "-lavfi", `${scale}[x];[x][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`, "-loop", "0", gif], framesDir);
    const size = (await stat(gif)).size;
    console.log(`${path.basename(gif)}: ${(size / 1e6).toFixed(2)} MB at ${width} px, ${fps} fps, ${dither}`);
    if (size <= GIF_LIMIT) break;
  }
  if (!args.includes("--keep-frames")) await rm(framesDir, { recursive: true, force: true });
}
if (existsSync(framesDir) && (await readdir(framesDir)).length === 0) await rm(framesDir, { recursive: true, force: true });
