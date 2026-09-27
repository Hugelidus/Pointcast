# Technical article outline — "How I built pointcast"

Working title: *"Alt+click while you talk: building a local-first spec generator for coding agents"*

Target length: 1800–2500 words. Audience: developers building browser extensions, working with local ML, or evaluating AI coding agent tooling. Draft in this file's sections; write full prose separately before publishing.

## 1. The problem (short, concrete)

- The exact phrase that started this: "make this sortable and move this next to that." A coding agent can't resolve "this."
- Why a screenshot/screen-recording doesn't fully solve it: the agent still needs the DOM element and the source file, not pixels.
- One-sentence positioning vs. MCP Pointer / react-grab (DOM only, no narration) and MarkuprPlus (narration over pixels, no DOM). Link: `docs/decisions.md` § Positioning.

## 2. Architecture in one diagram

- Reuse the architecture diagram from `docs/decisions.md`: content scripts → offscreen document (MediaRecorder + event buffer) ↔ service worker/popup (state machine) → Downloads folder → CLI (transcribe → fuse → render).
- Why capture and processing are separate: capture must be dumb and faithful; processing needs to be iterable and re-runnable on old recordings (`words.json` cached, re-render in milliseconds after a fusion change).

## 3. Fusion: aligning words to gestures with dynamic programming

- The core problem: spoken deictic words ("this", "that") happen close in time to pointing gestures (Alt+click, selection), but not simultaneously, and greedy nearest-neighbor matching provably picks the wrong pairing (worked example: "this" at 1.0s / "and this" at 2.1s vs. clicks at 2.0s / 2.6s — greedy scores 2.9, DP scores 1.5).
- DP formulation: events and deictics as intervals, cost table (`window`, `costUnmatchedEvent`, `costUnmatchedDeictic`, `clickMatchPenalty`), unmatched-event handling (bursts, pauses, long silences).
- Why plain clicks were dropped from capture entirely after Phase 1 (product decision, not just a cost tweak) — noise in the appendix from clicks that were just "using the app," not pointing.
- Pure, synthetic-fixture TDD: no audio, no browser, sub-millisecond fusion.

## 4. The timestamp false alarm

- The story: an early benchmark reported ~1.1 s word-start error for every model tested — looked like transformers.js's word timestamps were unusable.
- The actual bug: the TTS ground truth paired words with the wrong times, not a transcription problem.
- The fix and the corrected numbers (165 ms median / 265 ms p90 word-start error), and the broader point: validate your ground truth before concluding your dependency is broken. A benchmark harness is code, and code has bugs.
- Link to the specific `docs/decisions.md` D1 note for the full numbers and the harness that caught it.

## 5. In-browser Whisper: making transformers.js work inside MV3

- Why move transcription into the extension at all: the CLI round-trip (record → save → open terminal → run CLI) was the main remaining friction.
- The spike (`spikes/in-browser-whisper/`) and its numbers: 43 s to transcribe 152 s of audio in the browser (4 WASM threads) vs. 26 s in Node — 1.7× slower, same accuracy (92.8%, same word-timing distribution).
- Three concrete MV3/CSP obstacles and their fixes:
  1. `'wasm-unsafe-eval'` needed in `content_security_policy.extension_pages` or ONNX Runtime can't compile WASM.
  2. MV3 forbids remote code — the ONNX Runtime `.wasm`/`.mjs` files must ship with the extension (resolved from `node_modules` at build time so they can't drift from the library version) instead of being fetched from jsDelivr; `wasmPaths` must be a URL-prefix string, not the `{wasm, mjs}` object form (which makes the library import a `blob:` URL that extension pages refuse).
  3. Cross-origin isolation (COOP/COEP in the manifest) is required for `SharedArrayBuffer`, and therefore multi-threaded WASM — without it, one thread only.
- The WebGPU surprise: slower than WASM on an RTX 3060 Ampere (51 s vs. 43 s fp32; `whisper-small` took 110 s), so it's opt-in via a `device` option, not the default — a reminder to measure on your own hardware rather than assume the newer backend wins.
- q8 quantization traded a faster load for a slower, less accurate run (46 s, 90.7% vs. 43 s, 92.8%) — fp32 stayed the default in both runtimes.
- Live transcription during recording: cutting audio into 15–30 s pieces at genuine pauses (never mid-word, using a dB-relative silence threshold) so only the last piece is left to transcribe after Stop — cut post-Stop latency from 27.2 s to 2.9 s on a 152 s recording with no accuracy loss.

## 6. Privacy by allowlist, not blocklist

- The core design stance: capture only what's on an explicit allowlist of HTML attributes; anything unforeseen is excluded by default, not "we'll remember to filter it out."
- Sensitive-field detection: `type="password"`, `autocomplete` values, a configurable marker attribute, extended to contenteditable rich-text editors and listbox options (real bugs found before shipping: chat/comment composers are contenteditable, and their content is exactly what the user typed).
- The canary test as the actual guarantee, not just documentation: type a marker string into password/token/card fields, click and select around it, assert zero occurrences in the saved session. A promise you can `git grep` for.
- Local-by-default plus opt-in-per-host for remote sites, and why: asking for "access to all sites" at install time for a tool that needs one host at a time would be a worse privacy posture than the tool it's protecting against.
- URL redaction as an easy thing to under-scope: not just query params, but path-segment tokens (`/reset/<token>/`) and personal-data patterns once redaction widens to remote sites.

## 7. Evaluating instead of assuming

- Why run a formal evaluation for what's still an early tool: launch claims should be falsifiable, and it's cheap to be wrong quietly.
- Pilot (one app, `docs/eval/pilot-2026-09-27.md`) → full evaluation (three real codebases, different frameworks, `docs/eval/results-2026-09-27.md`) — escalating rigor before publishing numbers.
- Headline result and its honest ceiling: pointing raises accuracy 78% → 89% over plain narration, but a careful hand-written description still wins (96%, fewer tokens) — the eval doesn't hide the case where the tool loses.
- A bug the evaluation surfaced and fixed before launch: SvelteKit's `display: contents` wrapper made every text selection invisible to `checkVisibility()`, so no selection was ever captured on SvelteKit apps until fixed.
- The grading discipline: a grader that initially over-counted correct answers by 8/45 (rejecting only "Recent Sales" without qualification, rejecting a same-text-different-link answer) — tightening it after a manual audit, even though it made the tool's own numbers look worse.

## 8. What's next

- Phase 2: source-location mapping from existing dev-server plugins, our own injectors where none exist.
- Phase 3 was pulled forward already (in-browser transcription); MCP server lets an agent fetch the latest recording itself instead of pasting.
- Link to `docs/decisions.md` and `docs/plan-phase-1.md` for anyone who wants the full design log, not just the highlights.

## Sources to link inline while drafting

- `docs/decisions.md` (D1, D4, D6, D7, D8)
- `docs/eval/pilot-2026-09-27.md`, `docs/eval/results-2026-09-27.md`
- `spikes/in-browser-whisper/`
- `docs/plan-phase-1.md`
