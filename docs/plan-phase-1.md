# Phase 1 plan — MVP

Goal: record a narrated session in Chrome and turn it into a Markdown spec with the CLI.
Order: riskiest parts first (audio in MV3, local transcription), and every step is verifiable on its own, so a failure points to one component.

Design rationale lives in [decisions.md](decisions.md).

| # | Step | Done when |
|---|---|---|
| 0 | **Repo skeleton + playground.** pnpm workspace, `core` package, Vitest, docs, playground pages. | `pnpm install`, `pnpm test` and `pnpm typecheck` succeed; `pnpm playground` serves http://localhost:5500; links do full page loads; SPA buttons change the URL without reloading. |
| 1 | **Extension skeleton (WXT).** Popup with Record/Stop, state in `chrome.storage.session`, `REC` badge. | `pnpm dev` launches Chrome with the extension; the badge toggles; after stopping the service worker in `chrome://extensions` the state survives; editing the popup reloads it automatically. |
| 2 | **Audio spike.** Permission page, offscreen document, `MediaRecorder`, export as 16 kHz mono WAV. | Recording 10 s while counting aloud produces a WAV that plays, lasts ~10 s and is 16 kHz mono; audio is uninterrupted while navigating between playground pages. |
| 3 | **Local transcription spike.** `pointcast transcribe <audio.wav>` → `words.json` via transformers.js. | A 2-minute Spanish recording is transcribed correctly by eye, in under 60 s on a laptop CPU, with start/end per word. Otherwise: bigger model, then OpenAI-compatible engine. |
| 4 | **Content script on local hosts + REC indicator.** | Indicator appears on `localhost:5500`, on a second port (`5173`) and on `http://app.localhost:5500`; not on other sites; it reappears after a reload. |
| 5 | **Click capture.** Capture-phase listeners, Alt+click = point without executing, events sent immediately, highlight flash. | 3 clicks → 3 events with increasing `t`; Alt+click on "Delete" does not remove the row; a click on a nav link is recorded before the page unloads. |
| 6 | **Drag selection + de-duplication.** Selection on `mouseup`; drop the `click` Chrome fires afterwards. | Dragging over the paragraph → 1 event (not 2); double-clicking a word → a selection; selecting across the list → container is the `ul`, not `main`. |
| 7 | **Element description.** Selector, readable path, label, source (nearest ancestor). | Every playground event has `selectorUnique: true`; no selector contains utility/hashed classes, `data-v-*`, `_ngcontent-*` or `:r1:`; "Export" reports `src/components/Toolbar.tsx:8 (ancestor +1)`. |
| 8 | **Privacy + HTML trimming.** Sanitize at capture with the attribute allowlist. | Canary test: type `CANARY-7391` into Password, API token and Card number, click and select around them → 0 occurrences in `session.json`; "Jane Doe" and the private note text are absent too. |
| 9 | **Session package.** `session.json` (`schemaVersion`, `t0`, recorder info, events) documented in `docs/session-format.md`, types in `core`. | Both files land in `Downloads/pointcast/<id>/`; a real export copied as a test fixture parses with the core types; SPA navigation yields events with the new URL. |
| 10 | **Sync test.** | Record saying "now" exactly on 5 clicks: median \|word start − event t\| < 0.4 s. If not, fix the clock before touching fusion. |
| 11 | **Fusion (TDD, synthetic fixtures).** | Tests pass for: 1 deictic + 1 event; "this… and this" + 2 clicks (the greedy-breaking case); event without deictic; deictic without event; "these three columns" + 3 clicks; event in a long silence; event before the first word. |
| 12 | **Render (TDD).** Inline markers, appendix, de-duplication, URL separators, budgets. | Snapshot tests pass; the CLI prints size in chars and estimated tokens. |
| 13 | **End-to-end CLI + acceptance.** `pointcast process [session-dir]` (default: latest session). | Record the example scenario on the playground, give the `.md` to Claude Code and ask which elements and files you want changed: it identifies them. |
