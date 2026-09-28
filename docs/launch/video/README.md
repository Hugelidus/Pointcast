# Pointcast demo animation and README clips

`node docs/launch/video/render.mjs [name…]` renders, from HTML drawn frame by frame in headless, muted Chromium (needs ffmpeg on PATH, or `FFMPEG=<path>`):

| Name | Source | Output |
|---|---|---|
| `demo` | `index.html` + `timeline.js` | `out/pointcast-demo.mp4` (1600x900, 30 fps, H.264, ~28 s, for the store and social posts), `out/pointcast-demo.gif` (800 px, under 5 MB) and one key frame per scene in `out/frames/` |
| `hero` | `clips.html?clip=hero` | `out/pointcast-hero.gif` (800 px, 9.6 s, under 2.5 MB: the README's top GIF) and `out/pointcast-hero-jump.png` |
| `typed` | `clips.html?clip=typed` | `out/pointcast-typed.gif` (640 px, under 1.2 MB) |
| `batch` | `clips.html?clip=batch` | `out/pointcast-batch.gif` |
| `mcp` | `clips.html?clip=mcp` | `out/pointcast-mcp.gif` |
| `errors` | `clips.html?clip=errors` | `out/pointcast-errors.gif` |

With no name it renders them all. GIFs use ffmpeg's two-pass palette (palettegen, then paletteuse on the changed rectangles) and step down (dither, fps, width) until they fit their budget. `--keys` renders only review frames; `--at 2.8,9.1` adds review frames at those instants. Every clip ends exactly where it starts, so the GIFs loop without a seam; the hero starts on its point, since GitHub shows a GIF's first frame before it loads.

The code in the animations is the real source of `dev/examples/react-dashboard`, fetched at render time, and the specs are the real rendering of those gestures (`renderMarkdown` after resolving against that example), abridged: lines left out, none invented. The hero's «Marco Peña» cell resolves to `src/components/OrdersTable.tsx:10`, the `ORDERS` row that holds the name. `shared.js` holds what both pages use: the source highlighting and the jump (the element's HTML struck out, an arrow to its line).

Open `index.html` or `clips.html?clip=hero` through any local server at the repository root to watch one loop (`#t=3.2` holds one instant).
