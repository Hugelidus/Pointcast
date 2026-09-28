// Renders the Pointcast animations to out/, each by name:
//
//   demo    index.html + timeline.js → pointcast-demo.mp4 (1600x900, 30 fps) and pointcast-demo.gif,
//           plus one key frame per scene in out/frames/
//   hero    clips.html?clip=hero → pointcast-hero.gif (800 px, ≤ 2.5 MB) and pointcast-hero-jump.png
//   typed   → pointcast-typed.gif   (640 px, ≤ 1.2 MB)
//   batch   → pointcast-batch.gif
//   mcp     → pointcast-mcp.gif
//   errors  → pointcast-errors.gif
//
//   node docs/launch/video/render.mjs                    # everything
//   node docs/launch/video/render.mjs hero typed         # only these
//   node docs/launch/video/render.mjs hero --keys        # only the key frames (quick review, in the frames dir)
//   node docs/launch/video/render.mjs hero --at 2.8,9.1  # only review frames at these instants
//   node docs/launch/video/render.mjs --frames-dir <dir> # where the frame dumps go (deleted at the end)
//
// The pages are served from the repository root on 127.0.0.1 (they read the logo in dev/scripts/icon/
// and the real source of dev/examples/react-dashboard) and drawn by headless, muted Chromium at device
// scale 1: window.renderAt(t) draws the instant t, so every frame is exact (t = i / fps), and the last
// frame flows into the first. ffmpeg (on PATH, or FFMPEG=<path>) encodes the MP4 (H.264, yuv420p,
// CRF 18, +faststart, no audio) and the GIFs (two-pass palette: palettegen on the frames that change,
// paletteuse on the changed rectangles), stepping a GIF down until it is under its budget.
// Runs at below-normal priority (ffmpeg and Chromium inherit it), ffmpeg on at most 8 threads.
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
const MB = 1024 * 1024;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ts": "text/plain; charset=utf-8", ".tsx": "text/plain; charset=utf-8" };

/** The demo's review frames, one per storyboard scene: seconds into the loop. */
const DEMO_KEYS = {
  "1-title": 0.5,
  "2-first-point": 3.05,
  "3-second-point": 5.65,
  "4-stop": 8.5,
  "5-spec": 11.5,
  "6-code": 14.7,
  "7-jump": 17.6,
  "8-type": 21.7,
  "9-typed-spec": 24.7,
  "10-end": 26.6,
};

/** What each name renders. `fps` is the frame dump's rate; a GIF's own rate can only step down from it. */
const CLIPS = {
  demo: { page: "index.html", size: [1600, 900], fps: 30, mp4: "pointcast-demo.mp4", gif: { file: "pointcast-demo.gif", width: 800, fps: 15, limit: 5 * MB } },
  hero: { page: "clips.html?clip=hero", size: [1600, 900], fps: 15, gif: { file: "pointcast-hero.gif", width: 800, fps: 15, limit: 2.5 * MB }, still: { file: "pointcast-hero-jump.png", t: 8.6 } },
  typed: { page: "clips.html?clip=typed", size: [1280, 800], fps: 15, gif: { file: "pointcast-typed.gif", width: 640, fps: 15, limit: 1.2 * MB } },
  batch: { page: "clips.html?clip=batch", size: [1280, 800], fps: 15, gif: { file: "pointcast-batch.gif", width: 640, fps: 15, limit: 1.2 * MB } },
  mcp: { page: "clips.html?clip=mcp", size: [1280, 800], fps: 15, gif: { file: "pointcast-mcp.gif", width: 640, fps: 15, limit: 1.2 * MB } },
  errors: { page: "clips.html?clip=errors", size: [1280, 800], fps: 15, gif: { file: "pointcast-errors.gif", width: 640, fps: 15, limit: 1.2 * MB } },
};

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const names = args.filter((a, i) => !a.startsWith("--") && !["--at", "--frames-dir"].includes(args[i - 1]));
for (const name of names) if (!CLIPS[name]) throw new Error(`unknown clip "${name}": ${Object.keys(CLIPS).join(", ")}`);
const selected = names.length ? names : Object.keys(CLIPS);
const keysOnly = args.includes("--keys") || args.includes("--at");
/** --at 2.8,6.6: extra review frames at these instants, written to the frames directory. */
const extra = valueOf("--at")?.split(",").map(Number) ?? [];
const framesRoot = path.resolve(valueOf("--frames-dir") ?? path.join(os.tmpdir(), "pointcast-video-frames"));
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
const ffmpeg = (commandArgs, cwd) => run(FFMPEG, ["-y", "-v", "error", "-threads", "8", "-filter_threads", "8", ...commandArgs], cwd);

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
const base = `http://127.0.0.1:${server.address().port}/docs/launch/video/`;

/** GIF: palette from the frames that change (stats_mode=diff), then only the changed rectangles. */
async function encodeGif(clip, framesDir) {
  const { file, width, fps, limit } = clip.gif;
  const gif = path.join(OUT, file);
  const tries = [
    { fps, width, dither: "sierra2_4a" },
    { fps, width, dither: "bayer:bayer_scale=3" },
    { fps: 12, width, dither: "bayer:bayer_scale=3" },
    { fps: 12, width: Math.round(width * 0.9), dither: "bayer:bayer_scale=3" },
    { fps: 10, width: Math.round(width * 0.9), dither: "bayer:bayer_scale=2" },
  ];
  for (const { fps: rate, width: w, dither } of tries) {
    const scale = `fps=${rate},scale=${w}:-2:flags=lanczos`;
    const palette = path.join(framesDir, "palette.png");
    const input = ["-framerate", String(clip.fps), "-i", "f%05d.png"];
    await ffmpeg([...input, "-vf", `${scale},palettegen=max_colors=256:stats_mode=diff`, palette], framesDir);
    await ffmpeg([...input, "-i", palette, "-lavfi", `${scale}[x];[x][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`, "-loop", "0", gif], framesDir);
    const size = (await stat(gif)).size;
    console.log(`${file}: ${(size / 1e6).toFixed(2)} MB at ${w} px, ${rate} fps, ${dither}`);
    if (size <= limit) return;
  }
  console.warn(`${file} is still over ${(limit / MB).toFixed(1)} MiB`);
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  for (const name of selected) {
    const clip = CLIPS[name];
    const [width, height] = clip.size;
    const framesDir = path.join(framesRoot, name);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("console", (m) => { if (m.type() === "error") console.error(`${name} page: ${m.text()}`); });
    await page.goto(`${base}${clip.page}${clip.page.includes("?") ? "&" : "?"}capture`, { waitUntil: "networkidle" });
    const duration = await page.evaluate(() => window.ready);
    const shot = async (t, file) => {
      await page.evaluate((time) => window.renderAt(time), t);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
    };

    // Review frames: the demo's scenes in out/frames (they are kept), a clip's in the frames dir.
    const keys = name === "demo" ? DEMO_KEYS : await page.evaluate((n) => window.CLIPS[n].keys, name);
    const keysDir = name === "demo" ? path.join(OUT, "frames") : framesDir;
    if (name === "demo" || keysOnly) {
      await mkdir(keysDir, { recursive: true });
      for (const [key, t] of Object.entries(keys)) await shot(t, path.join(keysDir, `${key}.png`));
      console.log(`${name}: ${Object.keys(keys).length} key frames in ${keysDir}`);
    }
    if (extra.length) {
      await mkdir(framesDir, { recursive: true });
      for (const t of extra) await shot(t, path.join(framesDir, `at-${t.toFixed(2)}.png`));
      console.log(`${name}: review frames in ${framesDir}`);
    }
    if (keysOnly) {
      await page.close();
      continue;
    }

    if (clip.still) await shot(clip.still.t, path.join(OUT, clip.still.file));
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const count = Math.round(duration * clip.fps);
    for (let i = 0; i < count; i++) {
      await shot(i / clip.fps, path.join(framesDir, `f${String(i).padStart(5, "0")}.png`));
      if (i % 60 === 0) console.log(`${name}: frame ${i}/${count}`);
    }
    await page.close();

    if (clip.mp4) {
      const mp4 = path.join(OUT, clip.mp4);
      await ffmpeg(["-framerate", String(clip.fps), "-i", "f%05d.png", "-c:v", "libx264", "-threads", "8", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4], framesDir);
      console.log(`${clip.mp4}: ${((await stat(mp4)).size / 1e6).toFixed(2)} MB, ${duration} s`);
    }
    if (clip.gif) await encodeGif(clip, framesDir);
    if (!args.includes("--keep-frames")) await rm(framesDir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  server.close();
}
if (existsSync(framesRoot) && (await readdir(framesRoot)).length === 0) await rm(framesRoot, { recursive: true, force: true });
