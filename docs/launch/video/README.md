# Pointcast demo animation

`node docs/launch/video/render.mjs` rebuilds `out/pointcast-demo.mp4` (1600x900, 30 fps, H.264), `out/pointcast-demo.gif` (800 px, 15 fps, ffmpeg two-pass palette, kept under 5 MB) and one key frame per scene in `out/frames/`, from `index.html` + `timeline.js` + `style.css` in headless, muted Chromium (needs ffmpeg on PATH, or `FFMPEG=<path>`). `--keys` renders only the key frames; `--at 2.8,9.1` adds review frames at those instants. Open `index.html` through any local server at the repository root to watch it loop (`#t=3.2` holds one instant).
