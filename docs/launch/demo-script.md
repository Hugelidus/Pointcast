# Demo GIF storyboard (~30 s)

> The launch uses the animated explainer instead (18 s, «View report» and «Export», arrows to `Dashboard.tsx:11` and `OrdersTable.tsx:22`): [video/](video/README.md), `video/out/pointcast-demo.mp4` and `.gif`. This storyboard stays for a later screen recording of the real extension and Claude Code.

Purpose: show the whole loop — record, talk + point at two elements, stop, and Claude Code applying it with `/pointcast` — in one glance, for the top of the README. Silent GIF (no audio track), captions carry the narration.

Why the React example and not the playground: what sets Pointcast apart is voice + several elements + **the line of code behind each one**. The playground is static HTML, so its spec has no code lines; `dev/examples/react-dashboard` is a Vite dev build of React 19, so the spec leads with `text at: src/…:line`, and it has the ambiguity pointing removes (two «View report» links, two «Export» buttons; see its [SCENARIOS.md](../../dev/examples/react-dashboard/SCENARIOS.md), scenarios 1 and 3).

Recording setup:

- `pnpm example:react` (http://127.0.0.1:5174), Chrome at 1280×800, extension popup pinned to the toolbar.
- Claude Code with the plugin installed (`claude plugin marketplace add Hugelidus/pointcast`, `claude plugin install pointcast@pointcast`), started in `dev/examples/react-dashboard`, so the MCP server resolves the code lines in that folder and receives the recording directly (no downloads).
- Make one short recording beforehand, off camera, so the speech model is already downloaded and Stop takes seconds. Record at 2x speed where noted so the whole thing reads in ~30 s; cut dead air.

| Time | Screen | Action | Caption (burned in) |
|---|---|---|---|
| 0:00–0:02 | Dashboard, Revenue and Orders cards and the Orders table visible | Click the Pointcast toolbar icon; popup opens | — |
| 0:02–0:04 | Popup | Click **Record** | "1. Press Record" |
| 0:04–0:05 | Page | REC pill appears in the corner | — |
| 0:05–0:10 | Page | Alt+click «View report» on the **Revenue** card (cursor visibly holds Alt); say (caption only) "This should take you to the reports page" | "2. Alt+click what you mean, and say it" |
| 0:10–0:15 | Page | Alt+click **Export** above the Orders table; say (caption) "And this button should export the order status too" | — |
| 0:15–0:17 | Page | Press Alt+Shift+S (show the keys) | "3. Press Stop" |
| 0:17–0:20 | Page pill | *Processing…* progress bar fills, then *✓ Copied* (2x speed) | "Transcribed locally, in the browser" |
| 0:20–0:24 | Cut to Claude Code | Type `/pointcast` and Enter; the tool call fetches the latest recording | "4. /pointcast in Claude Code" |
| 0:24–0:30 | Claude Code | Show the two requests with `text at: src/pages/Dashboard.tsx:11` and `text at: src/components/OrdersTable.tsx:22`, then the agent's edit to those two files (2x speed; cut before the full diff) | "The exact elements, and the lines behind them" |

Export: GIF or animated WebP, ≤ 8 MB, ≤ 900 px wide (GitHub renders README images at that width), 12–15 fps is enough for a screen recording and keeps the file small. An MP4 uploaded as a GitHub attachment plays inline too and weighs less. Save to `docs/launch/demo.gif` and replace the `promo-marquee.png` banner at the top of `README.md` with it.

Do NOT record real personal data, a real password, or a real third-party site: use the example dashboard in this repository, whose data is synthetic. Keep the Settings tab (password and API key fields) off camera anyway, and close other terminal tabs and editor panes that could show paths or names.
