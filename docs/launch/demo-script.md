# Demo GIF storyboard (~25 s)

Purpose: show the whole loop — record, talk + point, stop, paste — in one glance, for the top of the README. Silent GIF (no audio track), captions carry the narration.

Recording setup: playground app (`pnpm playground`, http://localhost:5500), Chrome at 1280×800, extension popup pinned to the toolbar. Record at 2x speed where noted so the whole thing reads in ~25 s; cut dead air.

| Time | Screen | Action | Caption (burned in) |
|---|---|---|---|
| 0:00–0:02 | Playground app, orders table visible | Click the pointcast toolbar icon; popup opens | — |
| 0:02–0:04 | Popup | Click **Record** | "1. Press Record" |
| 0:04–0:05 | Page | REC pill appears top-right | — |
| 0:05–0:10 | Page | Alt+click the "Quantity" column header (cursor visibly holds Alt); say (caption only) "This should be sortable by quantity" | "2. Alt+click what you mean, and say it" |
| 0:10–0:14 | Page | Select the word "Export" on the toolbar button; say (caption) "And this should only export the filtered rows" | — |
| 0:14–0:16 | Popup or page pill | Click **Stop** (or show Alt+Shift+S) | "3. Press Stop" |
| 0:16–0:20 | Page pill | *Processing… ~0:05* progress bar fills, then *✓ Copied* | "Transcribed locally, in the browser" |
| 0:20–0:25 | Split screen or cut to Claude Code / Cursor | Paste (Ctrl+V) into the agent's prompt box; show the rendered Markdown with `[a]`/`[b]` markers matching the two requests | "4. Paste it into your agent" |

Export: GIF, ≤ 8 MB, ≤ 900 px wide (GitHub renders README images at that width), 12–15 fps is enough for a screen-recording GIF and keeps the file small. Save to `docs/launch/demo.gif` and swap the placeholder path in `README.md`.

Do NOT record real personal data, a real password, or a real third-party site — use the playground pages in this repo, which are synthetic fixtures.
