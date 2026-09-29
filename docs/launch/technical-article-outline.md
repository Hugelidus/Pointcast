# Article outline: "Making a coding agent know which line of code you're pointing at"

For dev.to (canonical) and Medium (import with the canonical URL set to the dev.to post, so search engines don't split it). Publish about a week after launch day ([launch-plan.md](launch-plan.md)), when the launch threads have brought questions worth answering in it.

- **Audience:** developers who use coding agents on web UIs, and people building agent tooling, browser extensions or local ML.
- **Length:** 2,800–3,300 words, 7 code blocks, 3 figures, the video at the top.
- **Tone:** an engineering write-up, not a launch post. Every number links to the report it comes from, and every section says what didn't work.
- **Tags (dev.to, max 4):** `ai`, `webdev`, `opensource`, `javascript`.
- **Cover image:** `docs/launch/store/social-preview.png` (1280×640), or frame `docs/launch/video/out/frames/6-code.png`.

## Title and subtitle

- **Title:** Making a coding agent know which line of code you're pointing at
- **Subtitle:** What I measured, why my resolver prefers silence to a guess, how Whisper invents speech in silence, and how a browser extension hands recordings to a local MCP server safely.
- **Alternate title:** "Silence beats a wrong answer: building a voice-and-pointer spec tool for coding agents"

## 0. Hook (150 words)

- The video (`docs/launch/video/out/pointcast-demo.mp4`, ~27.5 s; the shorter hero GIF, 9.6 s, works for Medium): Alt+click a table cell while talking; the spec's line draws an arrow to it in the editor. Not the HTML — the source line that makes it.
- The one-line problem: "make this sortable" is how people talk about UIs, and an agent can't resolve "this". The page has two «Export» buttons; which one?
- What the article covers: five engineering decisions, each with a number behind it.

## 1. What the tool does, in one diagram (250 words)

- Figure 1: extension (content script captures Alt+click / selection; offscreen document records audio and runs Whisper) → at Stop, fuse words with gestures → spec → local MCP server (127.0.0.1:20547) → the agent's `/pointcast` or `get_session` tool → resolver reads the repo → `text at: file:line`.
- The spec, as it appears (code block from README "How it works": Request 2, «Export» → `used at`, `text at`, `within`, `on screen`).
- Where the code chain comes from: React 19 `_debugOwner`/`_debugStack`, Vue 3 `__vueParentComponent`/`__file`, Svelte 5 `__svelte_meta`; for Django, HTML comments from `pointcast-django` (section 3). Dev builds only, and why that's acceptable: you edit code in development anyway.
- Sources: [README](../../README.md#how-it-works), [D9](../decisions.md#d9-source-mapping).

## 2. Measure before you claim: the evaluation (700 words)

The core section. The story is that the first evaluation said something unflattering, and that decided what to build next.

- **Setup** ([results-2026-09-27.md](../eval/archive/results-2026-09-27.md)): three open-source admin dashboards (shadcn-admin / React 19, vuestic-admin / Vue 3, flowbite-svelte-admin / Svelte 5), 5 changes each, spoken in Spanish with synthesized narration, recorded by the real extension in headless Chromium with gestures timed to the word. The agent under test: `claude -p`, Sonnet, medium effort, Read/Grep/Glob only, no MCP, asked to list file, line and target, not to edit. 36 runs, $3.42.
- **Conditions:** Pointcast spec vs. the same transcript without pointing (M1) vs. a careful written description (M2).
- **Result table** (copy the four-row table): pointing 89% vs. 78% without; M2 96% with a third fewer tokens. "Pointcast does not save tokens" was the report's own conclusion.
- **The grader story:** a manual audit of every answer found the grader had counted 8 wrong answers as right, mostly in pointcast's favour (P-requests would have read 43/45). It was tightened before the tables were computed. Lesson: audit your grader against the answers, especially when it flatters you.
- **What the failures taught:** a shared component rendering the same text twice (the flowbite «Sales Report» link, 0/6) needs the card around the element; a selection made at the start of a sentence was attached to the previous one. Both fixed and re-run (addendum: shadcn 13→15/15, flowbite 12→13/15).
- **Stage 0, the code pointer** ([stage0-code-pointer-2026-09-27.md](../eval/archive/stage0-code-pointer-2026-09-27.md)): a bar fixed before any run (≥ 40/45, ≥ 30% fewer tokens, no new "edited the shared component" errors). The winning variant (component chain + a repo lookup of the element's text) got 44/45 at 39.9k input tokens per run vs. 93.7k (−57%), with 0 searches before the first right file; a realistic quickly-typed request (M3) got 35/45 at 90.5k. The chain alone failed the bar: in 2 of 6 runs the agent edited the shared `nav-group.tsx` instead of the sidebar data. That failure is why the lookup exists, and it leads straight into section 5.
- **The follow-up, on the shipped product** ([results-2026-09-28.md](../eval/archive/results-2026-09-28.md), [results-2026-09-28-batching.md](../eval/archive/results-2026-09-28-batching.md)): once typed notes, the MCP server and Django were real, not a probe, one change per request showed no token saving (30.5k vs 28.0k for a hand-typed request) — the fixed cost of a run swamps the one grep it avoids. The saving reappears once a recording batches several changes, which is how people actually use it: six changes in one recording got the right code 96% of the time against 85% for the same six typed by hand in one message, at 24% fewer input tokens and 75% fewer searches. One change per request stays a little more accurate for both variants (96% vs. 84%), but not cheaper. Say plainly which of these two evaluations backs which claim; they measure different things.
- **Limits, stated in the article, not a footnote:** 3–5 runs per condition, 15–16 changes, one model; the written-description conditions were written by someone who knew the scenarios (or, in the follow-up, by an LLM writer looking at a screenshot); Stage 0's chains came from a probe, and the recommended re-run with product-captured chains on an unseen app hasn't happened yet.

## 3. Server-rendered pages: pointing at a Django template (350 words)

- The problem, from a colleague's real app: a Django + HTMX project with ~1,300 templates produced specs with no code pointer; server-rendered HTML has no component metadata. Never name the app.
- The injector: `pointcast-django`, one line under `if DEBUG`. It wraps each project template's output in `<!-- pointcast:begin file="…" -->` / `<!-- pointcast:end … -->` (code block from [integrations/django/README.md](../../integrations/django/README.md#what-it-does)).
- The interesting bug: wrapping `Template._render` silently disappeared on every page django-debug-toolbar recorded, because its templates panel replaces that method; hooking `Template.compile_nodelist` and `BlockNode.render` survives it.
- Guarantees: nothing with `DEBUG` off, only HTML output, no absolute paths, and a test that the markers are the only difference from Django's output.
- The number: a read-only dry run on the ~1,300-template app placed ~94% of sampled on-screen elements on their exact line, 0 wrong ([D9, Django note](../decisions.md#d9-source-mapping)).

## 4. Two things users asked for: typing instead of talking, and knowing why it broke (350 words)

- **Typed mode** ([D12](../decisions.md#d12-typed-mode)): not everyone can or wants to talk (open-plan office, a call, no microphone, a language Whisper handles badly). The popup gets a two-option switch above Record; a typed session opens no microphone, downloads no speech model, and each gesture opens a small note box next to the element instead. Every noted gesture becomes its own request; nothing else about capture, the code pointer or the handoff changes.
- **The one implementation detail worth a paragraph:** the note box lives in a closed shadow root, and a capture-phase listener on `window` stops the page's own keyboard shortcuts from firing while it's open (typing "/" would otherwise trigger a search shortcut, Backspace a "delete row" handler) — without blocking the text from reaching the box.
- **Debug capture** ([D13](../decisions.md#d13-debug-capture)): the most common bug report is "this button does nothing". Now, while recording, Pointcast keeps the console errors and failed requests from 5 s before each gesture to 3 s after, and the spec lists them under the element:

  ```markdown
  - [a] button «Export» in «Broken buttons» on `/errors.html`
    - errors around this moment:
      - network: `POST /api/export` → 500 (0.6 s before)
      - uncaught: `TypeError: Cannot read properties of undefined (reading 'rows')` at `errors.js:22` (0.3 s before)
  ```

- **Why 5 s and 3 s:** Alt+click is cancelled before it reaches the page, so the click that fails happens before the user points and says so; 3 s after covers a request still in flight. On, redacted, everywhere by default — query strings, tokens and sensitive-field values are stripped before a message is kept, the same rules that redact page text ([D8](../decisions.md#d8-privacy)).
- One line on the same evaluation's fix that shipped alongside these: the resolver no longer resolves a `find:` line into a library's own code (`node_modules`, `.pnpm`) — a Radix or shadcn/ui wrapper is skipped rather than mistaken for the user's file, closing the "edited the shared component" failure mode from section 2 for good.

## 5. The resolver: silence beats a wrong answer (600 words)

- **The job:** turn "the element's component chain" into one `file:line`. The chain says where an instance is used; the text the user wants changed can live in the instance's props, in a data file, or in a shared component.
- **The rules, as tested** (numbered list from D9): only the chain's files, never a library's own; the element's literal as a code literal, exactly once → `text at:`; else its label; else its link's href, one import hop into data modules → `data at:`; otherwise nothing.
- **Why "exactly once":** «Users» is written twice in `Dashboard.svelte`; a guess would point at the wrong card. Put the asymmetry plainly: a missing line costs the agent one search (it still has the DOM description); a wrong line costs a confident edit in the wrong place, which the user may not notice.
- **Evidence it holds:** in Stage 0, none of the lookup's lines caused a wrong answer; in the Django dry run, 0 wrong across the sample, and the template rules turned "1 located, 1 wrong" into "101 located, 0 wrong" on text between template tags.
- **Rules that close silences without guessing** (Django pass): innermost template first; of several hits, the one inside the element's own tag; ignore `<script>`, attribute values and `{% if %}` operands. Each one was accepted only after the remaining silences were classified by hand.
- **Short values:** a lone «3» can't be searched (it's everywhere), so the capture records the item it belongs to ("next to «Messages»") and the resolver finds the value inside that entry, or says nothing.
- **Comments are not code:** a JSDoc naming the "Export" button made the real line look written twice; comments are stripped before searching.
- Code block: the spec for the Chats badge before and after the lookup (`nav-group.tsx` vs. `sidebar-data.ts:73`).

## 6. Whisper invents speech on silence: the VAD fix (500 words)

- **Symptom** ([D1, note 2026-09-28](../decisions.md#d1-transcription--whisper-via-transformersjs-locally)): 15 s of room noise at −49 dBFS became "¡Adiós!"; a tester's recording had "Por favor, vengan a la vida." nine times over 15 s of silence, and "de la" ×430 in a 19.2 s recording. Each invented sentence became a request of its own in the spec.
- **Why:** OpenAI's reference implementation limits this with a no-speech threshold and temperature fallbacks; faster-whisper adds a VAD; transformers.js has none of these, and it was called bare.
- **Fix 1, VAD first:** Silero VAD v5 (2.2 MB, MIT) through the ONNX Runtime that transformers.js already ships, so nothing new has to be bundled into an MV3 extension. Only speech goes to Whisper, laid end to end; word times are mapped back. faster-whisper's settings kept after measuring (silences under 2 s stay, 400 ms padding); cutting every pause lost a whole sentence.
- **Fix 2, generation limits:** at most 12 tokens per second of audio plus 24, `no_repeat_ngram_size: 12`, passed inside `generation_config` (a direct `max_new_tokens` makes transformers.js skip Whisper's seek loop: a gotcha worth a code block).
- **Fix 3, a pure sanitizer:** drop words outside the audio, zero-length runs, loops of a phrase repeated 3+ times, and known silence phrases ("Thank you.", "Gracias.") only when they're 500 ms from any speech the VAD heard. A tighter rule deleted a real "Gracias." Whisper had timed 350 ms late.
- **Signal, not silence:** dropped stretches are recorded (`unreliable`), and the spec says in one line where the transcript was dropped.
- **Result:** noise-only audio went from one invented word each to none; word accuracy on the Spanish fixtures unchanged (93.8%, 92.8%); the 2-minute fixture got faster (18 s vs. 20 s) because long pauses are cut.

## 7. Handing recordings to a local MCP server, safely (500 words)

- **Why:** extensions can only write files through Chrome's downloads; with "Ask where to save each file" on, every recording opened Save dialogs and landed in the wrong folder. The agent's MCP server is already running, so the extension posts the recording to it on `127.0.0.1:20547` ([D11](../decisions.md#d11-handoff-to-a-running-mcp-server)).
- **The threat model table** (who could post to a loopback port): web pages, including DNS-rebinding pages; other extensions; a different program on the port; other OS users on a shared machine.
- **The gate, before any body byte is read:** `POST` only; `Host` exactly `127.0.0.1:<port>` (defeats DNS rebinding); `Origin` in an allowlist of extension ids (a page can't forge `Origin`); a custom header `X-Pointcast-Handoff: 1` and `application/octet-stream` (both force a CORS preflight the server never answers). Failures get an empty 403.
- **Facts it relies on**, verified in headless Chrome: an extension's POST carries `Origin: chrome-extension://<id>`, with no preflight thanks to its host permission; `referrerPolicy: "no-referrer"` turns it into `Origin: null` (so the extension keeps the default).
- **A fixed extension id:** every non-store build carries the store item's public key as the manifest `key`, so all builds share one id the server can pin.
- **Never lose a recording:** hello first, upload second; any refusal or timeout falls back to Chrome's downloads. Write to a hidden `.incoming-*` folder, rename, never overwrite.
- **What it accepts, openly:** other OS users on a shared machine could reach the port; there is a switch on both sides (`--no-handoff`), and native messaging is the upgrade path. Say why pairing tokens were rejected (the extension can't read a file the CLI writes).
- The e2e test that checks web pages (no-cors, beacon, custom headers) can't inject a session.

## 8. What I'd do differently, and what's next (250 words)

- Evaluate earlier: the first eval changed the roadmap (from "pointing" to "pointing at code").
- Write the bar down before the run; it stopped at least one tempting reading of noisy results.
- Next: the product-captured re-run on an unseen app; code lines through webpack/Next.js dev servers; Angular; Jinja/Rails/Laravel templates with the same comment markers; Firefox.
- Call to action: try it on your app and report where it pointed wrong (issues), or pick up a `help wanted` issue.

## Checklist before publishing

- [ ] Every number matches its report on the day of publishing (they may have been re-run).
- [ ] The Django app is never named; "a real ~1,300-template Django + HTMX app".
- [ ] Links are absolute GitHub URLs (dev.to doesn't resolve relative ones).
- [ ] The video is embedded (dev.to: upload the GIF or link the MP4; Medium: GIF).
- [ ] Canonical URL set on Medium.
- [ ] Posted to the repository's Discussions as an announcement, and linked from the README's FAQ if it answers a common question.
