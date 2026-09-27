# Reddit posts

General notes: post the same core content, adjust framing per subreddit's norms. Read each sub's rules before posting (self-promotion limits, flair requirements) — this is a draft, not a submit button.

---

## r/ClaudeAI

**Title:** I built a Chrome extension that turns "make this sortable" into a spec Claude Code can actually use

**Body:**

If you use Claude Code (or Cursor, or any agent) for UI work, you've probably typed something like "make this table sortable and move this button next to that one" and then had to go back and clarify which element you meant, because the agent can't see your screen.

I built **pointcast**: a Chrome extension. Press Record, talk normally about the change you want, and Alt+click or select the element you're talking about as you say it. Press Stop — it transcribes locally in the browser (no audio leaves your machine), lines up your words with what you pointed at, and copies a Markdown spec ready to paste into Claude Code:

```markdown
## Request 1
> This [a] should be sortable by quantity.
- [a] th «Quantity» (selected) on `/index.html`
  - in: `main › section#orders › table#orders-table › thead › tr › th[3]`
```

I ran an eval before posting this instead of just vibes: on real React/Vue/Svelte admin dashboards, giving Claude (Sonnet, medium effort) the pointcast spec instead of the same spoken words without pointing raised correct-element identification from 78% to 89%, specifically on the ambiguous cases (duplicate buttons/cards, shared components). Numbers and methodology: [docs/eval](../eval/results-2026-09-27.md).

MIT licensed, Chrome only for now (Phase 1). Would love feedback from anyone doing a lot of UI iteration with Claude Code — especially where the pointing/transcription gets it wrong.

GitHub: <link>

---

## r/cursor

**Title:** Point at the UI element while you talk to Cursor — Chrome extension that generates the spec

**Body:**

Cursor is great once it knows exactly which element you mean, but "this button" and "that card" are exactly the references it can't resolve from text alone. I built **pointcast** to fix that at the source: record your voice while you Alt+click or select the elements you're describing, and it hands you back a Markdown spec with each request paired to the exact selector, DOM path, and (when available) the component + `file:line`.

Transcription is local (Whisper in the browser via transformers.js), nothing leaves your machine by default, and it only runs on localhost unless you explicitly enable a host.

Ran a real evaluation (not just a demo) on three open-source dashboards to see if pointing actually helps vs. just describing things in words — it does, especially where there's ambiguity (duplicate buttons, shared components): 78% → 89% correct-element accuracy. Full write-up: [docs/eval](../eval/results-2026-09-27.md).

MIT, open source, Phase 1 (Chrome only, source locations limited to what your dev build already exposes). Feedback welcome, especially from people iterating fast on UI with Cursor.

GitHub: <link>

---

## r/webdev

**Title:** Built a Chrome extension that fixes "make this bigger" ambiguity for AI coding agents — narrate + point, get a Markdown spec

**Body:**

Anyone who's tried directing an AI coding agent through UI changes has hit this: you say "make this table sortable" but the agent has no idea what "this" refers to. A screenshot doesn't fully solve it either — the agent still needs the actual DOM element and ideally the source file.

**pointcast** is a Chrome extension (MIT licensed): Record, talk while you Alt+click or select the elements you mean, Stop — it transcribes your voice locally in the browser, aligns the words to your pointing gestures with a small DP alignment algorithm, and copies a Markdown spec with selector/DOM-path/source-location per element, grouped by request.

A few things that might interest this sub specifically:
- **Selector algorithm** prioritizes test attributes → stable id → semantic attrs → CSS-module-safe classes → nth-of-type fallback, and explicitly filters out Tailwind/CSS-module hash noise, `data-v-*`, `_ngcontent-*`, Radix/MUI generated ids.
- **Framework-agnostic capture**, with component name + `file:line` when your dev build exposes it (verified across React, Vue, Svelte during evaluation — had to fix a SvelteKit-specific visibility bug: `display: contents` wrappers made Chrome's `checkVisibility()` report everything as hidden).
- Runs only on localhost by default; other sites are opt-in per host, with personal-data redaction turned on automatically once you do.

I ran a proper evaluation across React/Vue/Svelte admin dashboards before calling this "done": pointing raises correct-element identification from 78% to 89% over plain narration. Full numbers: [docs/eval](../eval/results-2026-09-27.md). Design rationale for the less obvious calls (fusion algorithm, HTML trimming, MV3 lifecycle gotchas) is all written down: [docs/decisions.md](../decisions.md).

GitHub: <link>

---

## r/LocalLLaMA

**Title:** Running Whisper (transformers.js) inside an MV3 Chrome extension offscreen document — numbers and gotchas

**Body:**

Sharing this mostly for the local-inference-in-the-browser details, since the actual product (a UI-narration tool for coding agents, pointcast) is secondary here.

Got `Xenova/whisper-base` fp32 running fully client-side inside a Chrome MV3 extension's offscreen document, no server, no API key:

- 152 s of Spanish audio transcribes in **43 s** in the browser (4 WASM threads) vs. 26 s in Node — 1.7× slower, same words, same word-timing accuracy (92.8% word accuracy, median 165 ms / p90 265 ms word-start error against ground truth).
- **WebGPU was *not* faster** on an RTX 3060 (Ampere): 51 s fp32 vs. 43 s WASM. `whisper-small` on WebGPU took 110 s. So WASM stays the default; the engine takes a `device` option per-machine.
- MV3 specifics that took real debugging: `'wasm-unsafe-eval'` needed in `content_security_policy.extension_pages` for ONNX Runtime to compile WASM; the ORT `.wasm`/`.mjs` files must be **served by the extension itself**, not fetched from jsDelivr (MV3 forbids remote code) and `wasmPaths` must be a URL-prefix string, not the `{wasm, mjs}` object form (that form makes the library import a `blob:` URL, which extension pages refuse); cross-origin isolation (COOP/COEP in the manifest) is required to get `SharedArrayBuffer` and therefore multi-threaded WASM — without it you're on 1 thread.
- q8 quantized weights loaded faster but were both slower to run (46 s) and less accurate (90.7%) than fp32 in this setup, so fp32 stayed the default in both the Node CLI and the browser.
- Now transcribes **while recording**, cutting audio into 15–30 s pieces at quiet points (never mid-word) so only the last piece is left after Stop — cut latency on a 152 s recording from 27.2 s to 2.9 s after Stop, same accuracy.

All measurements and the reasoning behind each default: [docs/decisions.md § D1](../decisions.md#d1-transcription--whisper-via-transformersjs-locally) and [spikes/in-browser-whisper](../../spikes/in-browser-whisper/). MIT licensed if anyone wants to reuse the transcription package (`packages/transcribe`, no `node:` imports, runs unchanged in Node or a browser worker).

GitHub: <link>
