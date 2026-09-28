# pointcast — design decisions

Status: accepted for Phase 1 (2026-09-26).
Each decision records what we chose, **why**, and what we rejected. To change a decision, edit it here and add a dated note.

## Problem

When you ask a coding agent for UI changes, it cannot resolve "this" or "here". A screen recording does not help much either: the agent needs to know *which DOM element* you mean and *which source file* renders it.

pointcast records a narrated session in the browser — your voice plus the elements you click or select — and turns it into a compact Markdown spec where every pointing gesture appears inline, next to the words you were saying:

> This *[00:04 · th «Quantity» · e1]* should be sortable, and this *[00:09 · button «Export» · Toolbar.tsx:12 · e2]* should only export the filtered rows.

An appendix lists each element in detail (selector, readable path, trimmed HTML, URL, source location when known).

## Positioning

Existing tools either capture DOM elements one at a time without narration (MCP Pointer, react-grab) or capture narration over screen pixels (MarkuprPlus). pointcast combines **DOM-level precision + narration + many elements over time**.

## Architecture

```
 ┌──────────────────────────────┐    event    ┌──────────────────────────────┐  POST 127.0.0.1:20547 (D11)
 │ content scripts              │ ──────────▶ │ offscreen document           │ ──────────────────────────▶ running `pointcast mcp`:
 │ click / selection → selector,│             │ MediaRecorder (microphone)   │   when one answers            <sessions folder>/<session>/
 │ path, sanitize, trim         │             │ t0 + event buffer            │
 └──────────────▲───────────────┘             └──────────────┬───────────────┘
                │ recording?                                 │ on stop (otherwise)
 ┌──────────────┴───────────────┐                            ▼
 │ service worker + popup       │ ── owns offscreen ──▶  Downloads/pointcast/<session>/
 │ state in storage.session     │                        audio.wav + session.json
 └──────────────────────────────┘                                    │
                                              cli (Node): transcribe → fuse → render
                                                                     │
                                                                     ▼
                                                                 session.md
```

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/core` | Session schema types, deictic lists, fusion, Markdown rendering. **Pure**: data in, data out, no I/O. | nothing |
| `packages/extension` | Chrome MV3 extension (WXT). Captures audio and events faithfully; on Stop, transcribes, fuses and renders in the browser (D6 note 2026-09-27), resolving code pointers from the page's Vite dev server (D9 note 2026-09-27, route 3). | core, transcribe |
| `packages/cli` | Node CLI published as `pointcast`. Transcribes audio, runs core, writes the `.md`. Its MCP server also receives recordings from the extension (D11). | core |
| `packages/transcribe` | Local Whisper engine (transformers.js), language detection, re-emitted-word cleanup. Runs unchanged in Node and in a browser worker: no `node:` imports, runtime settings come in as options. | core (types) |
| `playground/` | Static pages imitating real-app patterns; the manual test bench. | nothing |

## D1. Transcription — Whisper via transformers.js, locally

**Choice.** Run Whisper with `@huggingface/transformers` (ONNX) in Node, requesting word-level timestamps. The model downloads automatically on first use. An alternative engine targets any **OpenAI-compatible transcription endpoint** (OpenAI `whisper-1`, Groq, or a local server) for users who prefer speed or quality over locality.

**Why.**
- Word-level timestamps are the core of the product: fusion needs to know *when* each word was said.
- Local by default: voice recordings of someone's app never leave their machine; no API key, no cost.
- No Python: the audience is frontend developers who live in npm. One `npx` beats "install Python, pip, a model".
- The same library runs in the browser, so moving transcription into the extension later (Phase 3) reuses code instead of rewriting it.

**Rejected.**
- *Web Speech API*: no word timestamps, only works live from the microphone (cannot re-process a recording), and Chrome sends audio to Google by default.
- *faster-whisper (Python)*: faster and more accurate on CPU, but forces a second runtime on every user.
- *WhisperX*: better alignment, but pulls in PyTorch; ±2 s fusion windows do not need that precision.

**Risk and validation.** transformers.js is slower than faster-whisper on CPU and its word timestamps are less proven. Phase 1 step 3 is a spike with explicit success criteria; if it fails we try a larger model, then make the API engine the default.

**Defaults.** Force the language when known (auto-detection fails when a recording starts with silence). Pass the visible texts of the captured elements as the initial prompt so Whisper spells UI labels correctly.

*Note 2026-09-26 (after the Phase 1 review).*
- **Language.** transformers.js does not detect the language: without one it silently transcribes as English, and a Spanish recording became an invented English sentence. The CLI takes `--language` or `POINTCAST_LANGUAGE`. Without either, the local engine detects the language itself. It skips the leading silence, scores Whisper's language tokens once on the first 30 s of speech, and uses the result only when it is at least 80 % sure. Below that it stops and asks for `--language`, and writes nothing to the cache.
- **Initial prompt.** The prompt is honoured by the OpenAI-compatible engine only. transformers.js 4.3 declares Whisper's `prompt_ids` but does not implement them, so the local engine (the default) ignores the prompt and prints a note saying so.
- **Long audio.** Audio over 30 s is transcribed in overlapping chunks. With word timestamps, the library sometimes emits the overlap twice (12 words repeated on the 2-minute fixture), so the engine drops words that go back in time.
- **Plan step 3 bar.** The bar is under 60 s for 2 minutes of Spanish. The default `Xenova/whisper-base` meets it: 152 s of audio takes 24–25 s on 4 threads, model load included, and `local.slow.test.ts` checks this. Its word starts are within 165 ms (median) and 265 ms (p90). These numbers come from a desktop i9-12900K, not a laptop; a laptop CPU should still have about 2× headroom. An earlier benchmark reported ~1.1 s word-start errors for every model, but that was a bug in the TTS ground truth (words paired with the wrong times), since fixed. Details: `scripts/bench/results.json`.

*Note 2026-09-27 (transcription moves into the extension).*
- **Why now.** The "Phase 3" idea above is pulled forward: installing a CLI and running it after every recording is the main friction left. The spike in `spikes/in-browser-whisper/` (i9-12900K, Chromium 153 headless) shows the browser is fast enough. `Xenova/whisper-base` fp32 on 4 WASM threads, inside an MV3 offscreen document, transcribes the 152 s fixture in 43 s (17 s per audio minute). That is 1.7× slower than Node (26 s), with the same words and the same word timings (92.8 % of words right, starts within 165 ms median / 265 ms p90). Loading takes 7.4 s the first time (291 MB download) and 1.6 s from the Cache API. The renderer peaks at about 2.7–3.8 GB. 8 threads bring it to 38 s. q8 weights load faster but are slower (46 s) and less accurate (90.7 %), so fp32 stays the default in both runtimes.
- **WebGPU is not the default.** On an RTX 3060 (Ampere) it was slower than WASM: 51 s for fp32, 52 s for fp16, with no accuracy gain. `whisper-small` on WebGPU took 110 s. The engine accepts `device`, so this can be revisited per machine.
- **MV3 facts the extension must respect.** Extension pages need `'wasm-unsafe-eval'` in `content_security_policy.extension_pages`, or ONNX Runtime cannot compile its WASM. The ONNX Runtime files must be served by the extension, not fetched from jsDelivr, and `wasmPaths` must be a URL prefix string (the `{wasm, mjs}` form makes the library import a `blob:` URL, which extension pages refuse). Hugging Face answers CORS requests from an extension, and the weights fit in the Cache API. The multi-threaded runs used a cross-origin isolated page (COOP/COEP in the manifest); a page without isolation was measured on 1 thread only (q8, 56–57 s).
- **One engine, two runtimes.** The local engine moved from `packages/cli` to `packages/transcribe`, which has no `node:` imports. Threads, WASM paths, model host, device and dtype come in as options, and a progress callback reports model download bytes and chunks done for the popup. Language errors carry a code (`language-uncertain`, `language-detection-unsupported`), and each interface asks in its own terms: the CLI names `--language`, the extension will show a language picker. The OpenAI-compatible engine and WAV reading stay in the CLI.
- **Chunk progress.** transformers.js 4.3 has no per-chunk callback. A `streamer` does not count chunks: Whisper's timestamp mode seeks inside a chunk and calls generate() several times per chunk (14 times for the 8 chunks of the 152 s fixture). The engine counts calls to the pipeline model's own `generate()`, which the pipeline makes once per chunk.

*Note 2026-09-27 (live transcription: only the last piece is left after Stop).*
- **What.** The extension transcribes while the user records. At Record the offscreen document starts the transcription worker, which loads the model right away. Every 2 s it checks the recording, and each finished piece goes to the worker while recording continues. After Stop only the last piece is left. Its words are joined to the earlier ones, with each piece's times shifted by its start.
- **Measured** (`e2e/stop-latency.spec.ts`, fake microphone, model cached, i9-12900K, before → after). The 11.6 s es-short takes 3.9 s → 2.9 s from Stop to saved Markdown: it is one piece, and only the model load is saved. The 152 s es-2min takes 27.2 s → 2.9 s. Accuracy against the SAPI ground truth holds: es-short stays at 93.8 %, and es-2min goes from 91.7 % to 92.8 %.
- **Where to cut.** Pieces are 15-30 s. At least 15 s gives Whisper context and keeps calls few. At most 30 s is Whisper's window, so a piece is never chunked again. Pieces do not overlap. A word can only be lost or doubled if a cut falls inside it, so cuts go in the middle of the quietest 300 ms stretch, and only where that stretch is a real pause: ≥ 20 dB below the piece's level, or below −60 dBFS. A piece with no pause by 30 s is cut at its quietest point anyway. The newest second of audio is never cut, because the recorder hands audio over in 1 s chunks. The cutter is pure (`packages/transcribe/src/segments.ts`), so it is unit-tested on synthetic audio. `packages/cli/src/transcribe/segments.slow.test.ts` replays es-2min as the extension sees it, with the real model. That gives 10 pieces, and every word next to a cut that one pass gets right also comes out in pieces. No span repeats, and time only moves forward. In Node, pieces get 266 of 290 words and one pass gets 269. The gap is Whisper's own variance with less context: a word in the middle of a piece comes out differently ("notrarse" / "no traerse"), not at its edges. The test allows 2 %. In the browser (bench above), pieces came out three words better.
- **How the audio is read while recording.** The MediaRecorder chunks recorded so far are decoded with the same `decodeAudioData` call used at Stop. The chunks form a valid WebM stream, because the first one carries the header. So the pieces are slices of the same samples as the final decode. An AudioWorklet tap would be cheaper, but its samples and its sample 0 would differ from the saved audio. The decode runs only once a cut is possible (15 s of new audio). Its cost grows with the length of the recording, so the total grows with its square. *Review 2026-09-27:* live transcription therefore stops cutting after the first 20 minutes (`LIVE_LIMIT_S`), and Stop transcribes the rest; a 60-minute recording would otherwise decode about 40 hours of audio, with a full 16 kHz copy each time next to the ~1 GB model. Decoding only the newest chunks behind the header chunk was rejected: MediaRecorder's chunk edges do not fall on WebM cluster edges, so that stream is not reliably decodable. When the model finished loading during the recording, the recorder says so at Stop (`modelLoaded`), so a first run goes straight to "Transcribing" instead of waiting on a download report that never comes.
- **CPU and memory while recording.** The live worker runs on `min(4, cores / 2)` threads. Pieces run one at a time, and each takes about 0.3 s per second of audio (spike numbers at 4 threads). The renderer holds the model (about 1 GB) for the whole recording, not only after Stop. This was the price accepted for not waiting.
- **Language.** The popup's language travels with Record. With Auto, the first piece detects it and later pieces reuse it. If detection is unsure on the first piece, live transcription is dropped: the fallback language is chosen on the whole recording, as before. A recording that is a single piece is transcribed exactly like the one-shot path, fallback included.
- **Fallback.** Anything that goes wrong makes live transcription give up, and Stop transcribes the whole recording in a fresh worker as before. That covers a decode or worker error, an unsure language, and a language changed in the popup during the recording. A problem costs time, never the transcript. The time estimate after Stop counts only the audio not transcribed yet. The speed learned for later estimates uses only the audio transcribed after Stop.

*Note 2026-09-28 (silence and loops).*
- **Problem.** Whisper invents speech on silence and can loop, and we passed its output through unfiltered. Reproduced: 15 s of room noise at −49 dBFS became "¡Adiós!", and 20 s became "¡Adiós!" timed 16.34–29.98 s. A user's test report had "Por favor, vengan a la vida." nine times over 15 s of silence, each one a request of its own, "Gracias." alone, and "de la" ×430 in a 19.2 s recording, timed up to 29.8 s with a last word ending at 0. OpenAI's implementation limits this with a no-speech threshold and a temperature fallback on compression ratio and log probability, and wrappers such as faster-whisper add a VAD. transformers.js has none of these, and we called it bare.
- **VAD first** (`packages/transcribe/src/speech.ts`, `vad.ts`). Silero VAD v5 (MIT, 2.2 MB of fp32 weights, `onnx-community/silero-vad`) runs through the ONNX Runtime that transformers.js already brings, in Node and in the extension's worker alike. No new code ships (MV3), and its weights are downloaded and cached like Whisper's, from the same host. It costs about 60 ms for 11.6 s of audio in Node. Only speech goes to Whisper, laid end to end, and the word times are mapped back to the recording. faster-whisper's settings were kept after measuring: silences under 2 s stay in, longer ones are cut, and 400 ms of padding stays on each side. Cutting every pause instead lost the first sentence of en-short. Up to 2 s before the first phrase are kept too. With only the padding there, the e2e fixture's recording came out without capitals or punctuation and lost a word. A recording with no speech gives no words, and no language is detected. If the VAD cannot be loaded, the engine says so and transcribes everything, as before.
- **Generation limits.** The engine allows 12 tokens per second of the chunk, plus 24 (normal speech is about 3/s). It also sets `no_repeat_ngram_size: 12`. Both are passed inside `generation_config`: a direct `max_new_tokens` makes transformers.js 4.3 skip Whisper's seek loop. The n-gram size was measured on the fixtures: 3 changed a correctly repeated word, 5 cost en-short two words, and 8 or 12 changed nothing. A repetition penalty of 1.1 cost es-2min a word, so it is not used.
- **Sanitizer** (`sanitize.ts`, pure). It drops words outside [0, duration] and words that end before they start. It drops runs of three or more zero-length words, since two in a row happen in fast speech. It keeps one copy of a phrase (up to 12 words) repeated three or more times in a row, plus the partial copy a loop ends on. It drops known silence phrases ("Gracias.", "Thank you.", Amara credits…) only when they lie at least 500 ms from any speech the VAD heard. A tighter rule dropped the real "Gracias." that closes es-2min: Whisper timed it 350 ms late, past the end of the VAD's speech.
- **Signal.** Stretches dropped by the loop and zero-length rules go into `WordsFile.unreliable` (optional, [session-format.md](session-format.md#words)). A single word repeated three times ("no, no, no") is collapsed without a warning. The renderer adds one line to the spec ("the transcript around 00:15–00:30 looked unreliable … and was dropped"). The popup warns, and so does the CLI. Live pieces shift their stretches to the recording's timeline, like their words.
- **Measured** (`POINTCAST_SLOW=1` tests, i9-12900K, 4 threads, before → after). Noise-only audio (15 s and 20 s at −49 dBFS, 30 s at −40 dBFS, in es, en and with auto-detection) goes from one invented word each to none. es-short, then 12 s of noise, then es-short again gives both phrases before and after, but before, the second "Esto" was missing and the first phrase's last word was stretched 3.4 s into the noise. Word accuracy against the SAPI ground truth is unchanged: es-short 93.8 %, en-short 68.8 %, es-2min 92.8 %. es-2min transcribes in 18 s instead of 20 s, because its long pauses are cut: 5 chunks instead of 8. In the extension (e2e build, headless Chromium), the worker downloads the VAD from the model host and runs it; `e2e/processing.spec.ts` passes.

## D2. Processing in a separate CLI; logic in a pure core

**Choice.** The extension only captures. A Node CLI does transcription, fusion and rendering. Fusion and rendering live in `core` as pure functions.

**Why.**
- Separating capture (dumb, faithful) from processing (smart, iterable) makes the session package a **stable contract**: when the algorithm improves, old recordings can be re-processed without re-recording.
- Pure functions are tested with synthetic JSON fixtures, without audio or a browser.
- `words.json` caches the slow step (transcription); fusion re-runs in milliseconds.

*Note 2026-09-27 (the extension transcribes; the CLI stays).* With D1's note of the same day, the extension transcribes, fuses and renders in the browser, and saves `session.json` + `words.json` + `session.md` (session format v2, [session-format.md](session-format.md)). The audio is saved only when the user asks for it. The core idea of this decision holds: fusion and rendering are still pure functions in `core`, and `words.json` is still saved, so a session can be re-processed without its audio when fusion improves. The CLI stays for three jobs:
- re-processing sessions (v1 and v2) after a fusion or rendering change, with `pointcast process`;
- the OpenAI-compatible engine, which needs a secret key the extension should not hold;
- slow machines, where Node is 1.7× faster than the browser on the same model (26 s vs 43 s for 152 s of audio in the spike).

## D3. Identifying elements: grep keys first, unique selector second

The agent never runs `querySelector`; it greps the codebase. So each event carries two kinds of information:

- **For the agent:** visible `text`, a `label` (aria-label, associated `<label>`, title, placeholder), a readable `path` of landmarks (`main › section#orders › table › thead › th[3]`) and `source` (`file:line`) when available.
- **For machines:** a `selector` that is unique in the document, plus `selectorUnique: boolean`.

**Selector algorithm.** Walk up from the element; at each level pick the most stable token, stop as soon as `querySelectorAll(selector)` matches exactly that one element:

1. Test/source attributes: `data-testid`, `data-test`, `data-cy`, source attributes (D9).
2. `id`, unless it looks generated.
3. Semantic attributes: `name`, `aria-label`, `role`, `type` (inputs), `for`, relative `href`.
4. Semantic classes; CSS-module classes by their stable prefix (`[class*="Toolbar_export__"]`).
5. Fallback: `tag:nth-of-type(n)`.

**Noise to ignore** (configurable heuristics): utility classes (Tailwind/UnoCSS: contain `:` `/` `[` or match utility prefixes), hashed classes (`css-1a2b3c`, `sc-…`, `svelte-…`), framework attributes (`data-v-…`, `_ngcontent-…`, `_nghost-…`), generated ids (`:r1:`, `radix-…`, `headlessui-…`, `mui-…`, long digit runs, UUIDs).

**Why not a library** (`@medv/finder`): our priority rules (source attributes, framework noise) are specific, and ~100 lines of our own code are easy to test and explain.

## D4. Fusion — monotonic alignment of events to deictic words

1. **Normalize words**: lowercase, strip punctuation and accents (`"This,"` → `this`).
2. **Deictics** (configurable): Spanish *esto, eso, este, esta, estos, estas, ese, esa, esos, esas, aquel…, aquí, ahí, allí, acá*; English *this, that, these, those, here, there*.
3. **Events are intervals**: click = `[t, t]`, selection = `[mousedown, mouseup]`. Distance to a word = gap between intervals (0 if they overlap).
4. **Dynamic programming**, assuming you point in the same order you speak (like `diff`). Costs:
   - match event ↔ deictic = distance in seconds, only if ≤ `window`;
   - event left unmatched = `costUnmatchedEvent` (higher than any valid match, so matching always wins when possible);
   - deictic left unmatched = `costUnmatchedDeictic` (cheap: people say "this" without pointing).

   Why not greedy nearest-neighbour: "this" at 1.0 s, "and this" at 2.1 s, clicks at 2.0 s and 2.6 s. Greedy gives the first click to the second "this" (0.1 s away) and the second click is left over or crosses. DP compares totals — 1.0 + 0.5 = 1.5 versus 0.1 + 2.5 + 0.3 = 2.9 — and picks the right pairing.
5. **Unmatched events**:
   - within `burstGap` of a matched event (chained) → same anchor ("these three columns" + 3 clicks → one marker, three elements);
   - else → nearest pause (gap between words ≥ `pauseMinGap`) within `pauseRadius`, else after the nearest word;
   - during a silence longer than `longSilence`, or outside speech → a line of its own.
6. **Render**: markers on the same anchor merge into one bracket; a URL change between events emits a separator line.

| Parameter | Default |
|---|---|
| `window` | 2.0 s |
| `costUnmatchedEvent` | 2.5 |
| `costUnmatchedDeictic` | 0.3 |
| `clickMatchPenalty` (option `clickMatchPenaltyMs`) | 0.5 (500 ms), added to a plain click's match cost |
| `burstGap` | 1.0 s |
| `pauseMinGap` | 0.3 s |
| `pauseRadius` | 1.0 s |
| `longSilence` | 3.0 s |

*Note 2026-09-26 (after rendering the e2e fixture, `fixtures/sessions/e2e-es`).*
- **A burst never spans a URL change.** An event joins a burst only if it is on the same page, compared the way URL separators compare pages (path + search; `#/route` fragments kept, `#top`-style fragments ignored). Why: in the fixture, e5..e10 happen on index.html, other.html and spa.html?view=/reports, each within `burstGap` of the one before. They were chained into one burst and rendered as one marker with no separator, so the reader could not tell which page each element was on. The renderer follows the same rule: a bracket never mixes pages. If a later page's events are anchored after the same word (here, the pause after "esto,"), that page gets its separator and its own line after the word.
- **Plain clicks pay `clickMatchPenalty` in the DP** (why: D7 note). The window still limits the distance only. A lone click 2.0 s away costs 2.5, which is still cheaper than leaving both it and the deictic unmatched (2.8).
- **Open question.** In the fixture, the second "esto" now matches e4 (an Alt+click on Delete at 8455 ms), not e2 (Export at 7539 ms, the element the speaker means). Whisper puts "esto," at 7900–8580 ms: the spoken word starts at 7528, and the end absorbs the comma. So e4 falls inside the word, and e2 is 361 ms before it. Measuring to the word's onset would pick e2 (361 vs 555 ms), which fits how people point: at or just before the word. That changes D4.3, though, so it waits for more recordings. The rendered marker at "esto" is the same either way (e2..e6, Export first).

*Note 2026-09-27 (eval: a selection landed in the previous request).*
- **What happened.** In the shadcn-admin recording ([results](eval/results-2026-09-27.md)) the user selected "You made 265 sales this month." while saying "Y el texto de ventas recientes…". Whisper stretched "fuera." to 24.91 s and "Y" starts at 25.53 s; the selection starts at 25.64 s, 106 ms into "Y". It matched no deictic, so rule 5 took the nearest pause, the one before "Y", and a pause marker goes after the word *before* the pause: "…fuera *[e5]*. Y el texto…". The `requests` format then listed the selection under the previous request, and agents got the change right in 1 of 3 runs per format.
- **Rule.** An unmatched event (or burst) anchored to a pause stays at the pause only when it starts before the pause's midpoint and does not start in the pause and run into the next word. Otherwise it goes after the nearest word from the pause on (kind `word`), which puts it in the following sentence. Why: people point as they start saying what they point at, so a gesture in the second half of a pause, or already over the next words, is about what comes next. A gesture in the first half still takes the pause, where a marker does not split a phrase. Implemented in `anchor.ts` (rule 3); tests reproduce the shadcn case with its real word times.
- **Effect on the e2e fixture.** e7..e10, the clicks on other pages at 9.35–9.49 s, happen while "que es porte" is said, after the pause that follows "esto,". They moved from that pause to "es" and "porte", so the classic transcript now splits "que es porte" with URL separators. The times say this is where they happened.

## D5. HTML — capture generously (already sanitized), render lean

- The session stores sanitized HTML up to ~2000 chars per event; budgets apply at render time, so the `.md` can be regenerated with other budgets without re-recording. Sanitization happens **at capture**: sensitive data is never stored.
- **Structural trimming**, never "first N characters" (which breaks tags and spends tokens on class soup):
  - attributes from an **allowlist** only: `id`, `name`, `type`, `role`, `aria-*`, `data-testid`, source attributes, `href`, `placeholder`, `title`, `alt`; `class` dropped when it is all noise; `style`, event handlers and `value` always dropped;
  - direct children only, at most 5 (`…(+12)`), texts ≤ 60 chars, `<svg>…</svg>` → `<svg/>`;
  - context comes from the readable `path`, not from the parent's HTML; one extra hint where it pays off (column header for a table cell, label for an input).
- Selections whose common container is huge (e.g. `main`) record start and end elements plus the text instead of the container.
- Default render budgets: inline marker ≈ 80 chars; appendix HTML ≤ 300 chars; each element appears once in the appendix even if pointed at twice.
- The CLI prints the output size (chars and estimated tokens) on every run.
- **Note 2026-09-27: `requests` is the default format.** On three real apps (36 `claude -p` runs, [results](eval/results-2026-09-27.md)) agents given the `requests` format were right on 40/45 changes against 38/45 with `classic` (after the grader audit described there), with 27 % fewer input tokens (97 k vs 134 k per run), fewer turns (12.2 vs 15.4) and less time (30 s vs 50 s). `classic` stays available (`--format classic`) for checking a recording against its timeline. The extension, the CLI and the MCP server all render the core default.
- **Note 2026-09-27: the card around an element (`ElementInfo.context`).** On flowbite-svelte-admin every pointcast run got the "Sales Report" link wrong: two cards render it with the shared `More` component, and the spec (`a «Sales Report»`, component `More`, path `main › a`) did not say which card. A person writing the request names the card ("$45,385 · Sales this week"). So capture now records the title of the card or section around the element, and the `requests` format shows it next to the element: `a «Sales Report» in «$45,385 · Sales this week»` ([session-format.md](session-format.md)).
  - **Rule.** Walking up at most 8 ancestors, and never to `<main>` or above (the page's title is not a card): the `aria-label`/`aria-labelledby` of the first named container, or else the first heading (`h1`–`h6`, `role=heading`) that comes before the element's block in the first ancestor that has one, plus the short line (≤ 40 characters) right after the heading. At most 60 characters, redacted on enabled sites like other text, and a heading that is the element itself is passed over.
  - **A wrong card is worse than none**, so doubtful headings are skipped: one in another item of the same list or grid (a sibling block with the same tag and class as the element's block), and one in a big sibling block (more than 25 elements: another card with its chart). A heading after the element titles what follows, not the element.
  - **Why a field of its own, not `hint`.** `hint` already holds the column header of a table cell and the form of a submit button, and a cell of one of two identical tables needs both.
- **Note 2026-09-27: code-first layout.** In the `requests` format, an element with code information now starts with its code locations by role, with the source lines they point at, and its on-screen description comes second. Elements without code information keep the layout above, and `layout: "dom-first"` keeps the whole spec as it was. The evaluation decides which layout is the default. Details in the [D9 note](#d9-source-mapping).

## D6. MV3 runtime layout

- **Service worker holds no state in variables**: Chrome stops it after ~30 s idle. State lives in `chrome.storage.session`.
- **Offscreen document** (`reason: USER_MEDIA`) owns the `MediaRecorder` and the event buffer: it is the only extension context that lives for the whole session and can use the microphone. Content scripts send events to it immediately, so nothing is lost when a page unloads.
- **Microphone permission** cannot be prompted from an offscreen document, so a visible extension page requests it once; the grant then applies to the extension origin.
- **One clock**: every context has its own `performance.now()` origin, so all timestamps use `Date.now()`. `t0` is taken from the recorder's `start` event, not the button press (100–300 ms apart).
- **Audio export as 16 kHz mono WAV**, decoded and resampled in the browser (`AudioContext`/`OfflineAudioContext`). Whisper needs exactly that format, and it spares users from installing ffmpeg.
- Output goes to `Downloads/pointcast/<session-id>/`: extensions can only write inside the downloads folder.

*Note 2026-09-26 (after the Phase 1 review).*
- **Busy states always end.** `starting` and `stopping` are left only by the code that entered them. If Chrome stops the service worker in between, a new instance finds the state busy, and the extension used to stay unusable until the browser restarted. Now:
  - on startup, the service worker repairs such a state before handling anything: it resumes an interrupted stop (the recorder answers a repeated stop with the same files), or goes back to idle with an error;
  - both recorder calls have timeouts.
- **A lost microphone is kept.** The recorder listens for its own `stop` event from the start, so a disconnected microphone no longer makes Stop wait forever. The audio up to that point is saved, and the popup says when it ended.
- **Events survive bad audio.** If the browser cannot decode the recording, the events are still saved, and the raw recording is saved as `audio.webm` together with the ffmpeg command to convert it.
- **Session ids are unique.** The service worker chooses the id and adds `-2`, `-3`… when the downloads history already has that folder (two sessions started in the same second).

*Note 2026-09-26 (content scripts in tabs that were already open).*
- **The bug.** A real 48.8 s recording saved its audio, but `session.json` had `"events": []`, and every Alt+click ran the app's action. Chrome injects manifest content scripts only into pages loaded *after* the extension is installed, updated, reloaded or re-enabled. A tab that was already open has no content script, or an orphaned copy from the old instance that can no longer reach the extension. Nothing in the extension injected one, and nothing told the user. The e2e suite missed it because it always opened pages after the extension had loaded.
- **The rule.** Every open tab on a local dev host (`LOCAL_HOST_MATCHES`) gets a live content script at three moments:
  - on `runtime.onInstalled` (install, update, reload, and every `wxt dev` rebuild);
  - before a recording is reported as started (this covers disable + enable, which fires no install event);
  - when the popup opens on a tab.

  The service worker pings the tab with `tabs.sendMessage` (the `content` target in `messages.ts`). No answer ("Receiving end does not exist") means no live script, so it injects the built content script with `scripting.executeScript` (new `scripting` permission). Other hosts are never touched (D8). A tab that cannot be scripted (a Chrome error page, or a tab stuck for 2 s, e.g. paused in the debugger) is skipped and never fails the recording.
- **One copy per page.** Every WXT content script announces itself with a DOM event when it starts, and older copies stop on it. This works across the separate isolated world Chrome gives a reloaded extension. So the newest copy always wins, whether the old one is an orphan or a duplicate from the same instance, and it releases the page (no stale REC badge, Alt+click back to the app). For that reason there is no "already loaded" flag in the content script: WXT announces the new copy before `main()` runs, so a copy that refused to start would leave the page with no live copy at all. Duplicates are avoided on the injecting side instead: the service worker injects only where no copy answers, and one attach per tab runs at a time.
- **The popup shows the active tab's status**: captured, not a local dev host (remote site, `file://`), or could not attach (with the reason). While recording, "not captured" is shown as an error, so a silent 0-event recording cannot go unnoticed.
- Verified by `e2e/extension-reload.spec.ts`, which fails without this change, and `e2e/tab-status.spec.ts`.

*Note 2026-09-27 (Stop → Markdown inside the extension).* With D1's and D2's notes of the same day, Stop now ends with the Markdown on the clipboard. How the MV3 runtime does it:
- **A fifth state, `processing`.** `idle → starting → recording → stopping → processing → idle`. `stopping` lasts until the recorder has stopped the microphone and decoded the audio (it answers the service worker then, well within one event's lifetime); `processing` covers transcription, fusion, rendering, the clipboard and the downloads. It follows the rules above:
  - **state in `storage.session`**: the stage and a time estimate live in the recorder state (`processing`), so the popup and every tab can draw them; the service worker keeps nothing in variables;
  - **repair after a restart**: a new service worker that finds `processing` waits if the offscreen document is alive (its report wakes the worker; `e2e/service-worker.spec.ts` stops the worker mid-processing and the session still completes), and goes back to idle with an error if the document is gone. A found `stopping` is resumed as before;
  - **timeouts**: the offscreen document gives up on transcription at a deadline (10 min + 2 × the audio length) and saves the session with its audio; a `chrome.alarms` alarm one minute later ends a state nobody finished (the document crashed). Alarms, not timers: they wake a stopped worker.
- **One recording, one worker.** The offscreen document (reasons `USER_MEDIA`, `WORKERS`, `CLIPBOARD`) decodes the recording to 16 kHz mono and runs `@pointcast/transcribe` in a module worker with `min(8, cores / 2)` WASM threads. The worker is terminated after the recording's last job: ONNX Runtime only gives its WASM memory back when the worker goes away. Since D1's live-transcription note, that worker starts at Record (4 threads at most) and is fed pieces of the recording while it is made.
- **Serialized handlers.** Processing reports arrive while Stop may still be awaiting the recorder; every handler that writes the state runs through one queue in the service worker (`background/serial.ts`), so read-modify-write cycles never interleave. The queue orders work in this instance; it holds no session state.
- **MV3 requirements** (spike facts, D1 note): `script-src 'self' 'wasm-unsafe-eval'` for extension pages; COOP `same-origin` + COEP `require-corp` in the manifest, so extension pages are cross-origin isolated and WASM gets threads (the popup and the permission page still work: `e2e/processing.spec.ts`); `unlimitedStorage` for the model in the Cache API. ONNX Runtime's `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` are copied at build time from the onnxruntime-web version that the resolved transformers.js depends on (`wxt.config.ts`) and served from `ort/`: no CDN, no remote code. The model weights (data, not code) come from Hugging Face on first use; a 429 is retried with backoff.
- **Clipboard** in the offscreen document: a textarea and `document.execCommand("copy")`, Chrome's documented pattern (an offscreen document has no focus, so `navigator.clipboard` is refused). The popup's *Copy again* uses `navigator.clipboard`, since a click gives it focus.
- **Nothing recorded is lost.** Transcription fails → `session.json` + `audio.wav` are saved and the CLI can finish the job. Language detection unsure → the previous session's language is used (or the best guess), the popup says so, and the audio is kept. Audio is otherwise saved only with *Keep audio*.
- **The user always sees what happens.** The in-page pill goes REC → *Processing… ~0:25* with a bar → *✓ Copied — paste it into your agent* (or the error) for a few seconds; the badge goes REC (red) → … (amber) → ✓ (green); a notification says when it is done or failed (popup setting). The time is an estimate: audio length × the transcription speed measured on this device in earlier runs (`chrome.storage.local`), plus the cached model load; the bar never shows 100 % before the files are saved. The first run shows the model download in MB instead. In the e2e suite (headless Chromium, i9-12900K, 8 threads), the 11.9 s fixture takes 5.0 s from Stop to saved in a fresh profile (model read from a local server into the Cache API), and a 4 s recording 2.9 s with the model cached.
- **The e2e build** (`wxt build --mode e2e`, `.output/chrome-mv3-e2e`) records clipboard writes, notifications and "Show in folder" in `storage.session` instead of performing them, and loads the model from a local server that serves transformers.js' `node_modules` cache: the suite never touches the developer's clipboard or screen and never downloads 291 MB.

*Note 2026-09-28 (the output can skip the downloads folder).* "Extensions can only write inside the downloads folder" still holds, but the extension no longer has to write at all: while a pointcast MCP server runs, the offscreen document hands it the recording over loopback, and the server writes the folder ([D11](#d11-handoff-to-a-running-mcp-server)). Chrome's downloads remain the fallback, and the one path when no server answers. The upload's timeouts (1.5 s hello + 30 s upload) fit inside the processing alarm's 60 s grace (`ALARM_GRACE_MS`), so the alarm never closes the offscreen document during an upload.

## D7. Pointing gesture

- **Alt+click points without executing**: the click is cancelled in the capture phase (`preventDefault` + `stopPropagation`), so pointing at "Delete" does not delete. Same convention as MCP Pointer. Must be verified to also cancel Chrome's Alt+click-to-download on links.
- Only deliberate gestures are captured: Alt+click (`point`) and drag/double-click text selection (`select`). A plain click is never recorded: it passes through to the app exactly as if pointcast were not there (no cancel, no flash, no draft). See the note below (2026-09-26, product decision) for why plain clicks were dropped after Phase 1 treated all three gestures equally.
- Listeners are registered on `window` in the capture phase so the app cannot hide events with `stopPropagation`.
- *Note 2026-09-26 (fusion):* the three gestures are no longer equal. A plain `click` adds `clickMatchPenalty` (default 0.5, the same as 500 ms of extra distance) to its DP match cost. So a point or a selection wins ties and near-ties, and a click still matches a deictic when no pointing gesture is nearby (`clickMatchPenaltyMs: 0` restores the Phase 1 behaviour). Evidence: in the first real recording (the e2e fixture), the second "esto" was matched to a plain click on Delete (e3, inside Whisper's word) instead of the Alt+click on Export (e2), only because the click was a few hundred ms closer. A plain click is often just using the app (deleting, navigating), while Alt+click and selection exist only to point.
- *Note 2026-09-26:* only the user's own input counts (`event.isTrusted`). Clicks created by page scripts are ignored: neither recorded nor cancelled. An app's own `a.click()` on a download link is not the user pointing, and a script on the page must not be able to inject "pointed" elements into the spec an agent reads.
- *Note 2026-09-26 (product decision: plain clicks are no longer recorded at all).* The click-match penalty above was a half-measure: it still recorded every plain click and only nudged fusion to prefer a nearby point or selection. In a real recording, plain clicks on containers and navigation (a tab, a row, a "View orders" button) produced noise in the appendix without narration ever pointing at them, and choosing automatically which clicks are meaningful and which are just using the app is not a problem worth solving — pointing correctly is cheap for the user and hard to infer reliably from timing alone. So capture drops plain clicks entirely: `capture.ts`'s `onClick` only cancels and emits for Alt+click; a plain click is not cancelled, not flashed, and produces no draft. This is capture-side only:
  - `Gesture` keeps its `"click"` value (`packages/core/src/schema.ts`) and fusion keeps matching `click` events with `clickMatchPenaltyMs`, so sessions recorded before this change (e.g. `fixtures/sessions/e2e-es`) still load and process unchanged;
  - only newly recorded sessions stop producing `click` events.
- *Note 2026-09-27 (Undo).* A mis-pointed gesture used to stay in the spec, and the only fix was to record again. **Undo** (popup button, or **Alt+Shift+U**) removes the last captured event while recording. The recorder drops it from its log, so the next gesture reuses its id and ids stay `e1..eN`; the service worker updates the popup's count and last-event line, and stores the undone id in `storage.session`, from which the page that captured it flashes the element in grey (dashed, never the capture red) and every visible page's pill says *Undone: button «Export» · Alt+click* for a moment. Only the last event, one press at a time: key repeat is ignored like Record/Stop's. Alt+Shift+Z was the first choice, but Chrome 153 refuses it as a suggested key (`src/shortcut.ts`).

## D8. Privacy

- Runs only on local development hosts: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test` (any port), plus the sites the user enables one by one (note 2026-09-27).
- Form field values are never captured. Text inside sensitive elements is redacted. Sensitive = `type="password"`, `autocomplete` in `current-password | new-password | one-time-code | cc-*`, or a configurable marker attribute (default `data-sensitive`) on the element or any ancestor.
- Attribute **allowlist**, not blocklist: anything unforeseen is excluded by default.
- Audio never leaves the machine with the default engine.
- Verified by the **canary test** (plan step 8).
- *Note 2026-09-26:* "form field values" includes:
  - **rich-text editors** (`contenteditable`): most chat and comment composers are built this way, and their content is what the user typed;
  - **anything inside a form control**, such as an `<option>` clicked in a listbox.

  URLs are redacted more widely too:
  - more secret parameter names: `jwt`, `state`, `nonce`, `credential`;
  - token-shaped values anywhere, including path segments such as `/reset/<token>/`;
  - a link's `href` is used in a selector only when redaction would not change it.

*Note 2026-09-27 (enabling pointcast on other sites).* Local dev hosts stay the default and need nothing. Any other http(s) site can be enabled **one host at a time**, from the popup, by the user:
- **Why.** Staging servers, preview deployments and internal tools are where UI feedback often happens, and they are not on `localhost`. Asking for all sites up front would make every install a "read and change all your data" extension for a tool that needs one host at a time.
- **How.** `optional_host_permissions: *://*/*` grants nothing at install. When the active tab is not local, the popup shows its host (it can read the URL thanks to `activeTab`, which only covers the tab the user opened the popup on) and **Enable on `<host>`**, which requests `*://<host>/*` (both schemes, any port, no subdomains); Chrome asks the user. The service worker then registers both content scripts for the granted hosts with `scripting.registerContentScripts` (persistent): the capture script and the MAIN-world framework script (`content-scripts/framework.js`, `world: MAIN`), with the manifest's timing, and attaches to the site's open tabs so the current page works without a reload. It does this on `permissions.onAdded`, not in the popup, because Chrome's permission prompt can close the popup before the request resolves.
- **One source of truth.** The granted permissions *are* the list of enabled sites; the only copy is a mirror in `storage.session` that open pages follow. Every grant or removal (also from Chrome's own *Site access* menu) and every install/update re-syncs the registration from them (`background/site-scripts.ts`). **Remove `<host>`** in the popup drops the permission; open pages of that site release themselves at once (they follow the site list in `storage.session`), because Chrome keeps a content script running after its permission is gone.
- **Privacy.** On a non-local page, capture runs with `redactPersonalData: true`: text that looks like personal data is redacted on top of the rules above, because a real site shows real people's data, not your fixtures. The popup says so next to the Enable/Remove button. Everything else in D8 applies unchanged.

*Note 2026-09-27 (review of enabling other sites).*
- **The event URL is redacted too.** On an enabled site, the URL goes through the same personal-data rules as the page text (percent-escapes decoded first): `?email=bob%40example.com` or an IBAN in the path is as personal as the row it came from. A date with its hour ("2026-09-27 18:30") is no longer taken for a phone number.
- **The last Markdown is not in `storage.session`.** Content scripts may read that whole area (they follow the recorder state there), and now they also run on remote sites the user enabled. The spec, with the whole transcript of a local app, moved to the extension origin's Cache API, which only the service worker and the popup can reach; it is cleared at browser start and on install/update, as `storage.session` is. The short event summaries (`lastEvent`, `undone`) stay: pages need `undone` to say what was undone.
- **Exact hosts only.** A wildcard grant from Chrome's own *Site access* menu ("On all sites", `*.example.com`) enables nothing: registering it would capture on every site, while the popup, which matches exact hosts, said those pages were not captured.
- **Syncs run one at a time** (their own queue in `site-scripts.ts`), so a site enabled and removed right away cannot leave a stale registration.
- **Attached tabs get the MAIN-world bridge too**, so events on a page that was open before the site was enabled carry their component name and file without a reload.

*Note 2026-09-27 (end-to-end test of enabling a site).*
- **The bug.** The manifest declared `optional_host_permissions: http://*/*, https://*/*`, and the popup requests `*://<host>/*`. Chrome grants a request only when a single declared pattern contains it, and `*://` (http and https) fits in neither, so every *Enable on <host>* failed with "Only permissions specified in the manifest may be requested". The unit tests stub the permissions API and could not see it; `e2e/enabled-site.spec.ts` did.
- **The fix.** The manifest declares `*://*/*` (`OPTIONAL_SITE_MATCHES` in `sites.ts`), and a unit test checks Chrome's containment rule against the patterns the popup asks for. Nothing more is granted at install, and Chrome's prompt still names the one host requested.
- **How the e2e grants a site.** Headless Chrome cannot show the permission prompt, and the popup offers *Enable* only for the tab it was opened on from the toolbar (`activeTab`). So the test gives the user's "Allow" through the API behind chrome://extensions' site access settings, then requests the popup's own pattern from an extension page; Chrome does not prompt again for a host already granted. Everything after that is the real path: `permissions.onAdded`, registered scripts, attaching the open tab, capture, and redaction of the page and URL.

*Note 2026-09-27 (absolute file paths in component/source data).*
- **The bug.** Vue 3 dev builds put the component's file on `component.type.__file` as an **absolute** path on the machine that ran the app (e.g. `C:/Users/hugob/Desktop/my-app/src/components/LineChart.vue`). `framework-main.ts` read it straight into `ElementInfo.component.file`, so `session.json` and the rendered Markdown carried the user's home directory and username. Svelte's source-map `loc.file`, React's `_debugSource.fileName` and a page's own `data-source`-style attribute (`SourceRef.file`, D9) can report an absolute path the same way, and none of them were normalized.
- **The fix.** `projectRelativePath` (`packages/core/src/paths.ts`) cuts an absolute path (a Windows drive letter, a `file://` URL, or a POSIX path rooted at a home directory) down to a project-relative one: at the last occurrence of a known project directory (`src/`, `app/`, `pages/`, `components/`, `lib/`), or, failing that, its last 3 segments — never a segment that would still name the home directory or the username after it. A `node_modules` path is shortened to `package/…` instead, since the spec names a library component by its package. An already-relative path (the common case) is returned unchanged. It runs twice:
  - **At capture:** `framework-main.ts` (Vue/Svelte/React readers) and the extension's `parseSource` (`lib/describe.ts`) normalize the file before it ever reaches `ElementInfo`. `component-bridge.ts`'s `parseComponentInfo` normalizes again, since the attribute it reads is untrusted page input and a page could write it directly, bypassing the MAIN-world script.
  - **At render (defense in depth):** `fullSource` and the `component` search hint (`packages/core/src/describe.ts`, `element-hints.ts`) normalize again, so a session recorded before this fix (or edited by hand) still renders without leaking the path.
- A plain rooted path with no home prefix (e.g. `/app/src/Toolbar.vue`, how some dev servers report a container-internal path) carries no user identity and is left as-is.

*Note 2026-09-28 (handoff to a running MCP server, [D11](#d11-handoff-to-a-running-mcp-server)).*
- **Loopback only.** The extension's one new request goes to `http://127.0.0.1:20547`, the user's own computer, and the receiver binds `127.0.0.1` only, never the network. Nothing leaves the machine, except through a port forward the user set up: a TCP forward of local 20547 to a host's 20547 (`ssh -L 20547:127.0.0.1:20547`, VS Code Remote-SSH or Codespaces auto-forwarding) rewrites neither `Host` nor `Origin`, so the host's receiver accepts the recording. That is the supported way to use a server on a remote dev machine (cli README); the docs warn that on a shared host the receiver can be another user's, and that a forward opened to the network (`ssh -g`) lets anyone forge both headers.
- **`~` display paths.** The server answers with the folder it stored the session in, with the home folder written as `~` (`~\Downloads\pointcast\2026-09-28_10-15-00`). The popup keeps that answer in `lastResult`, in `storage.session`, which content scripts on enabled remote sites can read (see the note above on the last Markdown). A folder outside the home folder (a Downloads folder moved to another drive, `--dir`, `POINTCAST_DIR`) is cut to its last two segments, the sessions folder and the session (`…\pointcast\2026-09-28_10-15-00`), because a path like `D:\Users\<name>\Downloads` holds the user name too. So the OS user name never enters `storage.session`, and never crosses the wire, unless the user named the sessions folder itself after it. Error messages from the server leave out absolute paths for the same reason.

## D9. Source mapping

- The extension reads a configurable list of attributes holding `file:line[:col]`, starting with `data-source`, from the element or its **nearest ancestor**, and records the distance (`Toolbar.tsx:12 (ancestor +2)`).
- Phase 2 first adds support for attributes injected by existing dev plugins (after verifying their exact format), and only writes our own injectors where nothing exists (e.g. server-side templates without a bundler).

*Note 2026-09-27 (code pointer: `renderedBy`, `resolved` and one resolver).* [Stage 0](eval/stage0-code-pointer-2026-09-27.md) tested adding a *code pointer* to each element. The winning variant, P-chain-repo, adds the chain of app components that rendered the element plus a small repo lookup. It got 44/45 with 39.9 k input tokens per run, against 43/45 and 93.7 k for the plain `requests` spec (−57 %). The chain alone failed the bar: in 2 of 6 runs the agent edited the shared sidebar component (`nav-group.tsx`) instead of the sidebar data. The lookup's line into `sidebar-data.ts` prevented that. What was built from it:
- **Contract.** `ElementInfo.renderedBy` is the chain, read from dev-mode data. `ElementInfo.resolved` is the lookup's result. Both are described in [session-format.md](session-format.md#elementinfo).
- **One resolver for every route.** `packages/core/src/resolve/` is pure. File access is injected as a `SourceReader` (`read(path)` of a project-relative path returns its contents or `undefined`), so the CLI and MCP server (local repo), the extension (dev server) and GitHub all run the same rules. `projectMatch` reports when none of the chain files can be read: the session is probably from another project, and a route can say so.
- **Lookup rules, as tested** (keep them unless an evaluation says otherwise):
  1. Only the chain files are searched, never the whole project.
  2. The element's literal: the selected text, else the visible text, then its word runs between numbers ("Active Now" in "Active Now +573"). Written as a code literal (between quotes, `>`/`<` or spaces) exactly once in exactly one chain file → `text at:`. Written more than once → nothing, and no further step.
  3. Else its label, once → `text at:`.
  4. Else its link's href (not `#…`), once across the chain files and the data modules (`.ts`, `.js`, `.json`…) they import directly. One hop only, through relative imports and the `@/`, `~/` and `$lib` aliases. The result points at the element's text next to the href → `data at:` (the Chats badge: `sidebar-data.ts:73`, `badge: '3'`).
  5. Otherwise nothing. Silence beats a wrong location: "Users" is written twice in `Dashboard.svelte`, and a guess would point at the wrong card.
- **Chain rules**, applied in core so the renderer and the resolver see the same chain:
  - library and generated frames are dropped, and their package names the next frame (`flowbite-svelte <TabItem>`);
  - consecutive frames in the same file collapse to the innermost one **before** the cap of 3. This decided the Chats badge: uncollapsed, the chain never leaves `nav-group.tsx`, so no chain file imports the data;
  - at most 3 frames.
- **Rendering** (the dom-first layout since the code-first note below). One `code:` line in Stage 0's wording, then the `text at:` / `data at:` lines, after `find:`. The classic appendix gets the same lines. Without `renderedBy` the spec is byte-identical to before. Two wordings are new and were not tested with agents: `data at:` (Stage 0 wrote `text at:` for the data file too), and `inside` instead of `at` on the first frame when it is the element's own tag in a shared component, that is, when the lookup found the literal outside that file (`` `<a>` inside `More.svelte:18` ← `<More>` at `ChartWidget.svelte:27` ``). Check both in the product re-run that Stage 0's recommendation asks for.
- **Safety.** `renderedBy` is page-controlled dev data, and a session folder can come from someone else. The resolver never passes a reader a path with `..`, a URL scheme or a drive letter. Readers should still confine reads to their root.
- **Checked on the real apps.** With Stage 0's chains as `renderedBy`, the resolver reproduces all 15 of Stage 0's lookups on the three evaluation apps (11 locations, 4 silent). The rendered specs match the P-chain-repo prompts except for the two new wordings.

*Note 2026-09-27 (route 3: resolving from the dev server).* Stage 0's recommendation said the lookup "needs the source, so the extension's clipboard copy alone cannot produce it". It can, with nothing installed, when the page is served by a Vite dev server: that server already serves the app's source. What was built (`packages/extension/src/offscreen/dev-server.ts`):
- **Vite only.** Vite serves any file inside its root as `GET <origin>/<file>?raw` → `export default "<contents as a JSON string>"`. That is the same in Vite 5, 7 and 8 and under SvelteKit (read in the source of the evaluation apps' Vite 5 and 7, where `@vitejs/plugin-vue` leaves `?raw` alone, and run on 7 and 8). The reader parses that literal and nothing else, so an SPA fallback's `index.html` is never taken for source. Vite is recognized by `/@vite/client` answering with JavaScript. `.json` files are sent as they are by Vite's static server, and are accepted as such. webpack and Next.js have no such endpoint, and finding source through their source maps would mean guessing chunk URLs. They are not attempted: the spec keeps the chain without `text at:`.
- **Paths.** `renderedBy` paths are project-relative, and Vite serves from its root. The reader tries a path as it is, then without its first one or two segments (a monorepo package: `apps/web/src/App.svelte` → `/src/App.svelte`). The first prefix that works is then used for every later file, so the resolver's import probes cost one request each.
- **Where it runs.** In the offscreen document, at Stop. Extension pages fetch hosts covered by the extension's host permissions without CORS. Checked headless: the response type is `basic` and no `Origin` header is sent, so Vite's `server.cors` setting does not matter, and a host outside the permissions fails. Events only come from local dev hosts and enabled sites (D8), so only those are read.
- **Time.** Resolution starts at Stop, in parallel with transcription, since the events are final then. All reads of a session share a 2 s budget (one `AbortController`). In practice the reads finish long before Whisper does, so Stop → clipboard is unchanged.
- **Silence over a wrong line.** A read cut short (timeout, network error) drops everything read from that origin: an unread file could make a literal look unique. A 404 just means the file is not there. The spec never says the lookup failed.
- **The user still sees it.** One line in the popup's details (`ProcessingResult.code` → `LastResult.code`): locations found, source read but nothing unambiguous, or *dev server source not available* with the reason (not Vite, files not served, no answer in time, unreachable). There is no line when no element has a chain.
- **Privacy.** The source stays in the offscreen document's memory while the resolver runs. The spec and `session.json` get only paths and line numbers (`resolved`, `via: "dev-server"`), and, since the code-first note below, the lines they point at (snippets). Nothing is logged, saved or sent anywhere else.
- **Verified.** Unit tests with a mocked fetch: raw-module parsing, 404, not Vite, SPA fallback, timeout and partial reads, unreachable server, prefix fallback. `e2e/dev-server.spec.ts` runs the whole path against a stand-in Vite server (`e2e/support/fake-vite.ts`). On the real evaluation apps, with the e2e build, headless, one Alt+click each:
  - flowbite-svelte-admin (SvelteKit, Vite 7): «Sales Report» gets `text at: src/lib/ChartWidget.svelte:27`, Stage 0's line;
  - shadcn-admin (React 19, Vite 8): the Chats badge gets `data at: src/components/layout/data/sidebar-data.ts:73`, through the one-hop import read from the dev server. This is the line that kept Stage 0's agents out of the shared `nav-group.tsx`.

  Stop → saved took 3.1–3.7 s in a fresh profile, model load included.
- **No GitHub button in the extension.** A popup button that filed the raw spec as a GitHub issue was considered and dropped: a raw spec is not a good issue without being rewritten first. `pointcast issue` stays in the CLI, experimental and parked.

*Note 2026-09-27 (code-first layout and source snippets).* The spec must say which **code** the user pointed at, not only which DOM element. The two are related but not the same: the Chats «3» badge is a `<span>` on screen, rendered by the shared `badge.tsx`, used at `nav-group.tsx:62`, with its value in `sidebar-data.ts:73`, and which one to edit depends on the request. What changed:
- **Code-first layout**, the new default of the `requests` format (`RenderOptions.layout: "code-first"`). An element with `renderedBy` or `resolved` starts with its code locations, each labelled by its role. Then comes `on screen:` with today's DOM description, then the usual `find:`, `in:`, `styles:`… lines:
  ```text
  - [a] «Sales Report» → code:
    - used at: `src/lib/ChartWidget.svelte:27` — `<More title="Sales Report" href="#top" />`
    - defined in: `src/lib/More.svelte` (shared — do not change it unless asked)
    - text at: `src/lib/ChartWidget.svelte:27` (same as used at)
    - within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`
    - on screen: a «Sales Report» in «$45,385 · Sales this week» on `/`
  ```
  - **used at**: the innermost instance the chain names, where it is written. The first frame is skipped when it is inside a component's definition: the element's own tag (Svelte's `loc`), or an unnamed instance whose literal the resolver found in another file. Then the next frame is the instance.
  - **defined in**: that definition's file. It is marked *shared* only on evidence: the literal is written outside it, the rule behind `inside` in the note above, now also applied to an unnamed first frame (the Chats badge's `badge.tsx`). For a library component it is the package (`` package `flowbite-svelte` ``), never a node_modules path.
  - **text at / data at**: the resolved locations, as before.
  - **within**: the rest of the chain, outwards, in Stage 0's wording.
  - The preamble gets one line, only when some element is laid out code-first: prefer the "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.
- **Snippets.** The resolver already reads the chain files and the data modules they import. It now keeps the line it points at, as `ResolvedLocation.snippet` and `CodeFrame.snippet` ([session-format.md](session-format.md#elementinfo)): one line, whitespace-collapsed, at most 200 characters, with the lines around it when it is shorter than 16 characters (a bare `Export`, `badge: '3',`). It reads nothing more. The code-first layout shows them next to "used at", "text at" and "data at". Vue and React 19 frames have no line, so their "used at" names the instance (`` `<VaButton>` ``) instead.
- **What stays as it was.**
  - Elements without code information (production builds, stacks without dev metadata) render exactly as before. A spec with no such element is byte-identical, preamble included.
  - `layout: "dom-first"` renders the spec as it was before this note (Stage 0's layout plus the two wordings above), without snippets.
  - The classic format is unchanged.
  - The CLI, the MCP server and the extension render the core default.
- **Privacy.** Snippets are the user's own source lines. So `session.json` and the spec now get the lines they point at, not only paths and line numbers (this amends the route-3 privacy bullet above). They go wherever the session goes: the local folder, the clipboard, the MCP client, or the issue that `pointcast issue` files in the repository they were read from. The rest of each file is never kept, and a sensitive element gets no snippet (D8: its line could hold the very text capture redacted).
- **Not evaluated; the evaluation decides the default.** Stage 0 tested the chain as one `code:` line. Roles, the preamble line and snippets are new. Two kinds of case pull in opposite directions:
  - «Users» and «Sales this week»: "used at" is a library component inside the app's card (`ProductMetricCard.svelte:11`, `ChartWidget.svelte:19`), and the right edit is the card's instance in "within" or at "text at".
  - «Top customers»: "used at" is right (`Stats.svelte:55`), although the text is written elsewhere.

  That is why the shared mark needs evidence and is never inferred from where the text is. The next evaluation compares `code-first` with `dom-first` on the same sessions and harness as Stage 0, and its result decides the default. Until then the default is `code-first`.

*Note 2026-09-27 (resolver: the files that define the chain's components; comments are not code).* Found while building `examples/react-dashboard` and `examples/vue-dashboard`.
- **The gap.** Lookup rule 1 searches only the chain files, and a chain frame is where an instance is *used*. In the most common app shape, the component that renders the element imports its own data: `<Sidebar />` is used in `App.tsx`, and `Sidebar.tsx` imports `NAV_ITEMS` from `data/nav.ts` and renders the «Messages 3» badge. React 19 and Vue frames have no line for the element's own tag, so `Sidebar.tsx` is not a chain file, `data/nav.ts` was never reached, and the spec had no `data at:`. The example had to lift `NAV_ITEMS` into `App.tsx` to work around it. Stage 0's apps did not show the gap: in their chains, the data was imported by a chain file (`app-sidebar.tsx` for the Chats badge).
- **Rule 4 (new).** When rules 1–3 find nothing on the chain files, and no literal was written twice there, they run once more over the chain files **plus the files that define the chain's components**. The one-hop data rule then also applies from those files. What counts as a definition file:
  - the element's own component file, first, when dev data gives it (`ElementInfo.component.file`: Vue's `__file`, Svelte's loc, React up to 18);
  - then, for each frame that names a component, the file that the frame's own file imports it from. That covers relative imports and the `@/`, `~/` and `$lib` aliases; default and named imports, `as` included; `.tsx`, `.ts`, `.jsx`, `.js`, `.vue` and `.svelte` files; index files, through one re-export (`$lib`'s `export { default as More } from './More.svelte'`);
  - a Vue or Svelte component imported under another name is matched by its file name (vuestic's `import RevenueUpdates from './cards/RevenueReport.vue'`).

  The uniqueness rule is unchanged. A literal written twice across that scope (e.g. in two definition files) gives nothing. A hit in a definition file is `text at:`, and one in a data module it imports is `data at:`.
- **A second pass, not one bigger scope.** Both were tried. One merged scope moves answers that Stage 0 validated. The React example's «View report» link would go from its instance's `reportHref` (`pages/Dashboard.tsx:11`, rule 3) to the shared `StatCard.tsx`, which writes the text once, because rule 1 comes first. That is the shared-component error Stage 0 was about. A merged scope can also silence a Stage 0 location when a definition repeats the literal. It also reads definitions for every element, which an existing test rules out. As a fallback pass, every Stage 0 answer stays exactly as it was by construction, and definitions are read only when the chain alone had nothing.
- **Comments are not code.** The search now skips comments: `<!-- -->` in templates, and `//` and `/* */` in scripts (JSX's `{/* */}` too). The stripping is line-based, with no parser. `//` and `/*` count only at a line start or after whitespace, `{` or `;`, so `https://` and `'/*'` stay code. Without this, a comment that quotes the text can be the only hit, which gives a wrong line. It can also make the real line look written twice, which gives silence: the example's `OrdersTable.tsx` has a JSDoc naming its "Export" button, and a JSX comment can name it in the parent. Commented-out imports are no longer followed either. Known limit: a comment marker inside a string, after whitespace (`" //"`), hides the rest of that line from the search (for `/*`, up to the next `*/`).
- **Checked.**
  - With Stage 0's chains, the 15 lookups on the three evaluation apps are unchanged (11 locations, 4 silent). So are the product-shaped React 19 and Vue chains of the Chats badge, «Download» and «Employees».
  - On scratch copies of both examples restructured to the natural pattern (the sidebar imports its data):
    - the badge and the «Messages 3» link get `data at: src/data/nav.ts:16` (React) and `:18` (Vue);
    - «View report» keeps its instance's line;
    - the Orders «Export» button now gets `text at:` its line in `OrdersTable.tsx` / `.vue`. Before, it got nothing, because only the file where the `OrdersTable` instance is used was searched.
  - Unit tests (`resolve.test.ts`) cover:
    - React 19 and Vue fixtures of that pattern;
    - an alias plus an index re-export;
    - comments that would steal or duplicate a match;
    - two definition files writing the literal (silence);
    - the chain's own answer winning over a definition.
- **Not covered.** These add nothing:
  - `export *` barrels (the barrel itself is searched, not what it re-exports);
  - a component declared in the file that uses it, or registered globally;
  - a React `displayName` that matches no import (`ForwardRef(Button)`).

*Note 2026-09-27 (short values: a «3» found through the item it belongs to).* From a real recording on `examples/react-dashboard`: the user Alt+clicked the sidebar badge «3» next to "Messages" and said "this says three but should be five". The spec got only `used at: src/App.tsx` `<Sidebar>`. The badge's own HTML and selector (`span.badge`) carry no href, so rule 3 had nothing, and a lone "3" cannot be searched: it is written all over a codebase. A person knows it is "the 3 next to Messages". Badges, counters, numeric cells and "+2" chips all look like this. What changed:
- **Capture: `ElementInfo.itemLabel`** ([session-format.md](session-format.md#elementinfo)). Only for a *short value*: visible text that is non-empty with no run of two letters (`isShortValue` in core, so capture and resolver agree: "3", "+5", "99+", "$4", "✓"). It is the label of the nearest item within 4 levels up (`li`, `a[href]`, `button`, `label`, an item `role`), read without the element's own text, or, for a table cell, the row's `th[scope=row]` or first other cell. It must contain a letter, is cut to 60 characters, and is read like `context`: through the sensitivity-aware text helpers, never for a sensitive element, and redacted on enabled sites (D8). The `requests` format says `span «3» next to «Messages» in «Main»`; the classic appendix, `- next to: «Messages»`.
- **Rule 3b (new), after the href rule.** The item label as a code literal, once across rule 3's files (the searched component files and the data modules they import); then, within that entry (rule 3's ±3 lines), the value on exactly one line → that line, `data at:` outside the component files, `text at:` inside. The label found but the value not next to it gives nothing: the count may be computed elsewhere, and silence beats a guess. The value may end its entry (`badge: 3 }`), so here a `}` or `]` may follow it, where the plain literal pattern wants a quote, `<`, `,` or the line end. Rule 3b also runs in rule 4's pass: in the natural app shape `Sidebar.tsx` imports its own `NAV_ITEMS`.
- **Rule 1 skips the value only when there is an item label.** A lone "3" is not a literal to trust: written once, it may be `columns: 3`; written twice, it silences everything after rule 1. With an item label, 3b looks the value up through it. Without one, rule 1 still searches it, because Stage 0 depends on that: vuestic's «2+» badge is found by rule 1 (`<template #text> 2+</template>`, `NotificationDropdown.vue:6`). Skipping every short value would turn that location into silence. That badge sits alone in its button, so a new capture gives it no item label either.
- **The examples use the natural pattern again.** `Sidebar.tsx` / `Sidebar.vue` import `NAV_ITEMS` themselves, instead of `App` lifting it and passing it down, the workaround from the note above. Their `SCENARIOS.md` lists the lines the spec produces now, and `packages/cli/src/resolve/examples.test.ts` checks them.
- **Checked.**
  - The 15 Stage 0 lookups on the three evaluation apps are unchanged (11 locations, 4 silent), and so are the product-shaped chains of the Chats badge, «Download» and «Employees». This holds by construction, since Stage 0's sessions have no `itemLabel`, and was also run on the apps. With the item label a new capture would add ("Chats"), the Chats badge still gets `sidebar-data.ts:73`, because rule 3 comes first.
  - The React example's badge, exactly as recorded plus `itemLabel`, gets `data at: src/data/nav.ts:16`; the Vue one gets `:18`. The same results come through a reader that serves Vite's `.js` aliases.
  - Unit tests: capture in jsdom (link, list, option and table cell; sensitive text, truncation, redaction), rendering, and the resolver: the React 19 and Vue badge, a value in a component file next to an unrelated `columns: 3`, the value not next to its label or written twice there (silence), and «2+».
- **Not covered.** A label that is translated or built at runtime (`t('nav.messages')`) is not a literal, so it gives nothing. Nor does a value written more than 3 lines away from its label.

## D10. Tooling and conventions

- TypeScript everywhere; pnpm workspaces; WXT for the extension (manifest generation, auto-reload, store packaging); Vitest for tests.
- Internal packages are consumed as TypeScript source (`exports` points to `src/index.ts`): no build step for `core` during development. The CLI is bundled before publishing to npm.
- Repository language: English. License: MIT.

## D11. Handoff to a running MCP server

*2026-09-28, extension and CLI 0.2.0.*

**Problem.** With Chrome's "Ask where to save each file before downloading" on, every file of every recording opened a Save dialog, and sessions missed `Downloads/pointcast/`, where the MCP server and the CLI look. The popup could only tell users to turn the setting off. An extension cannot write files any other way (D6).

**Choice.** At Stop, once the Markdown is on the clipboard, the offscreen document asks `http://127.0.0.1:20547` whether a pointcast MCP server is there (`POST /pointcast/v1/hello`). If one is, it sends the session's files in one `POST /pointcast/v1/sessions/<id>`, and the server stores them in the sessions folder its own tools read (`--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`). Chrome downloads nothing, so no dialog can appear. Otherwise Chrome's downloads save the recording exactly as before. The protocol is in [session-format.md](session-format.md#protocol-v1); its constants and parsers in `packages/core/src/handoff.ts`.

**Why.**
- It fixes the Ask-where problem for the users who have an agent open, with nothing to configure: the setting is on by default and only acts when a server answers.
- The files land where the tools read them, even when Chrome saves downloads elsewhere.
- The MCP server is already running whenever an agent can use a recording.

**Facts it relies on** (headless Chrome for Testing 153, Node 22 on Windows 11, and the MCP SDK 1.30.1 source):

| Fact | Consequence |
|---|---|
| An extension page's `fetch` POST to `http://127.0.0.1:<port>` carries `Origin: chrome-extension://<id>`; a GET carries none. | The server can pin the sender, and every endpoint is POST, the hello included. |
| No CORS preflight for the extension, even with a custom header, thanks to its host permission on `127.0.0.1`; the answer is readable under COEP `require-corp`, and a Blob body gets a `Content-Length`. | No `OPTIONS` handling and no `Access-Control-*` headers. |
| With `referrerPolicy: "no-referrer"`, Chrome sends `Origin: null` on that POST (Fetch spec). | The extension keeps the default referrer policy; the e2e test checks the Origin the receiver saw. |
| A refused connection to `127.0.0.1` costs about 16 ms through `fetch`. | The hello runs after processing, one request after the other, at no noticeable cost. |
| `StdioServerTransport` never listens for the end of stdin. | A ref'd listener would keep a dead MCP process alive, so the receiver is `unref()`'d and closed when stdin ends. |
| Content scripts can read `storage.session` (D8 note 2026-09-27). | The folder shown in the popup is a `~` path (D8 note 2026-09-28). |

**Who can send (the gate).** Every request is checked before routing and before any byte of the body is read: method `POST`, `Host` exactly `127.0.0.1:<bound port>`, `Origin` in the allowlist, and `X-Pointcast-Handoff: 1`. A failure answers 403 with an empty body. The upload must also be `application/octet-stream`.
- *Web pages*, including the user's own dev app and DNS-rebinding pages: a page cannot forge `Origin`, the custom header and content type force a preflight the server refuses, and a rebound page's `Host` is not `127.0.0.1`. The empty 403 tells it nothing.
- *Other extensions* carry their own id. The allowlist is `OFFICIAL_EXTENSION_IDS` (the Chrome Web Store item's id; the Edge Add-ons id is appended once known) plus `POINTCAST_EXTENSION_IDS` for forks and stores not listed yet. An unlisted `chrome-extension://` origin gets a JSON `unknown-extension` answer, so the popup can name the id to add. Accepting any extension would let every extension with loopback access inject sessions.
- *A program that is not pointcast* on the port only receives the empty hello, fails the answer check, and the extension falls back silently; `redirect: "error"` stops a bounce elsewhere.
- *Same-user local processes* can already write the folder: no change.
- *Other OS users on a shared machine* (accepted): loopback is shared, so they could post a session to the user's server, or hold the port while it is down and receive recordings. Both sides have a switch (the popup's *Send to a running pointcast MCP server*, `pointcast mcp --no-handoff` / `POINTCAST_HANDOFF=off`). A browser cannot authenticate an OS user to a loopback socket without pairing; development machines are single-user; the dev-server reads (D9) already share this exposure. Native messaging or a peer-uid check are the upgrade path ([ideas.md](ideas.md)).

**A fixed extension id.** Pinning the sender needs one id for every build. The Chrome Web Store item (first submitted as 0.1.2 without a manifest `key`) has the id the store assigned. Every other build (the GitHub release zip, `pnpm build`, `pnpm dev`, the e2e build) carries that item's **public** key as the manifest `key` (`EXTENSION_PUBLIC_KEY`), so Chrome derives the same id from it; nothing is signed with it. The store uploads leave the key out (`zip:store`, which builds with wxt.store.config.ts: a production build like the others, only without the key), since the store sets the id itself. Bonus: unzipping a new release into a new folder no longer creates a new id, so the 291 MB model is no longer downloaded again after each update. Cost: unpacked 0.1.x installs must be removed and loaded again once, since their id changes (the model downloads and the microphone is allowed once more).

**Several servers.** One fixed port: the first `pointcast mcp` to bind it receives, the others log once and try again every 3 s. `EADDRINUSE` is the election: all instances read the same folder by default, so any receiver will do. While the user's server holds the port, nobody else can take it; a port range would let a squatter on a lower port win. Up to 3 s after the receiver exits, a Stop falls back to downloads once. With different `--dir`, a recording lands in the receiver's folder, and the popup shows which.

**Storing.** The server buffers the body (at most 256 MiB, 32 MiB per text file, checked from the headers first), validates `session.json` (its id must be the URL's) and `words.json` with the CLI's own validators and `session.md` as UTF-8, and writes a hidden `.incoming-<random>` folder that it renames to `<id>`. It never overwrites (409 when the folder exists) and never renames a session to `-2`: ids collide only within one second, and renaming would mean rewriting `session.json` and re-rendering `session.md`. It commits only if the extension is still connected, so an upload the extension gave up on cannot also be stored. Readers skip dot folders, and the server sweeps stale ones. The audio is not sniffed, and nothing is fsynced, like Chrome's downloads.

**Never lose a recording.** The Blobs stay in the offscreen document until one path has saved them. Any failure (a refusal, 409, 413, 500, a timeout: hello 1.5 s, upload 30 s) falls back to Chrome's downloads. Nothing on the port, or a non-pointcast program, is silent; a pointcast server that refuses, fails, does not accept this build, or speaks another protocol version gets one line in the popup, so a user who does run a server learns why the dialogs came back, and one who never does is not nagged.

**The MCP process now also writes.** The receiver runs inside `pointcast mcp`, but its tools stay read-only (annotated `readOnlyHint`). It logs to stderr only, since stdout is the MCP channel, and does not log refusals, so web pages cannot flood the agent's log. A bug in it is contained: an isolated module, started inside try/catch, `unref`'d, with caps and `--no-handoff`.

**Pinned plugin versions.** `npx` reuses a cached copy for an unversioned `pointcast`, so plugin users would have stayed on 0.1.0, which has no receiver. The Claude Code and Codex plugin and the Gemini CLI extension start the CLI's exact version, `pointcast@0.2.0`, bumped with each CLI release (CONTRIBUTING). Note 2026-09-28: first an x-range (`pointcast@0.2`), changed to an exact version because the Claude plugin directory requires one, so the package it reviews is the one that runs.

**Tests.** The e2e build hands off to port 5542, never 20547, so the user's real server and real extension never meet the tests. `e2e/handoff.spec.ts` runs the real CLI, and checks that web pages (no-cors, beacon, custom headers) cannot inject a session.

**Rejected.**
- *Native messaging*: a per-OS host manifest and registry keys the user installs. Heavy for a beta; it is the upgrade path for shared machines.
- *A pairing code or token*: the extension cannot read a file the CLI writes, and pairing is friction on a single-user machine.
- *No hello, a direct POST*: the recording would reach any program on the port, and a refused build would be learned only after the upload.
- *Probing at Stop, in parallel with processing*: saves about 16 ms and threads a promise through processing; the hello after processing also finds a server started meanwhile.
- *A range of ports with discovery*: complexity, and a squatter on a lower port wins even while the user's server runs.
- *A multipart body*: a "simple" content type (no preflight), and the concatenated body is as simple and exact.
- *Streaming to disk*: a state machine, where the buffered body is bounded by the cap.
- *`mkdir <id>` plus `session.json.part`*: the half-written folder is visible to the tools.
- *Retries and content-based idempotency*: no retry exists to need them; the still-connected check covers the one duplicate path.
- *A reveal endpoint for Show in folder*: an HTTP request would start a file manager inside the agent's MCP process ([ideas.md](ideas.md)).

## Out of scope for Phase 1

iframes, shadow DOM and canvas content; a UI to configure hosts beyond enabling the current site (D8 note 2026-09-27); MCP server; Phase 2 source injectors; Firefox. (Transcription inside the extension was pulled forward on 2026-09-27: D1, D2 and D6 notes.)
