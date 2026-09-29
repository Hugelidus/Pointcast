# Changelog

## Unreleased

- **How your agent applies requests** ([D5 note 2026-09-29](docs/decisions.md#d5-html--capture-generously-already-sanitized-render-lean), [evaluation](docs/eval/results-2026-09-29-instruction-style.md)). New popup setting. **Build what I mean** (the new default): the spec tells the agent that the elements say *where*; a request about an existing element changes exactly that, and a request for something new (a behaviour, a component, content, an animation) is built well, in the app's style, touching other files if it needs to. **Change only what I point at**: the line every spec had so far, "Change only the referenced elements, and only as asked." In a blind review of ten requests on a real app, the same recording scored 192/200 with the new line against 146 with the old one, and 174 for a carefully written prompt that took ten times longer to give. The choice is saved in `session.json` (`instructionStyle`), so the clipboard, the MCP server and the CLI word it the same; recordings made before it existed read as Build what I mean. Override it with `pointcast process --style intent|precise`, the MCP tools' `style` argument (`get_session`, `wait_for_recording`) or `/pointcast precise`. The spec grows by about 90 tokens.
- Claude Code and Codex plugin: the MCP server inside the plugin is now called `recordings`, so tool calls read "plugin pointcast recordings: wait for recording" instead of "pointcast pointcast". After updating the plugin, Claude Code asks once more before the first tool call. To turn it off for a project: `/mcp` → `plugin:pointcast:recordings`.
- `/pointcast watch` always reports what it changed before listening again.
- Fixed: a Stop message without a transcription quality (an older service worker next to a newer build) now uses Fast instead of failing the recording (#56).

## 0.8.0 (2026-09-29)

Extension, CLI and integrations at 0.8.0. The MCP server becomes the main path: `/pointcast watch` applies each recording as soon as you press Stop.

**Code lines on React 19 + Vite** ([D9 note 2026-09-29](docs/decisions.md#d9-source-mapping))
- Fixed: on React 19 with Vite, `used at:` and `within:` named the file with no line (``used at: `src/App.tsx` — `<Sidebar>` ``). They now give the line, like React 18 did: ``used at: `src/App.tsx:12` — `<Sidebar page={page} onNavigate={setPage} />` ``, and the element's own component gets its line in `find:`.
- How: right after the gesture, the page reads the modules its own Vite dev server already serves and maps the stack positions through their inline source maps, like the Next.js path does. Local dev hosts only, same origin only, in memory, within the same 3 s budget; no new permission.
- Silent when unsure: a missing map, a module edited since the element was rendered, or a map that names another file leaves the file without a line, as before. Files in the chain never change, only lines are added.
- New e2e test against the real `dev/examples/react-dashboard` dev server (`dev/e2e/vite-react19.spec.ts`).
- Fixed: a dev page left open across an extension update or reload kept answering with the older build's code, so its gestures got files without lines (and no component file) until the page was reloaded. The newest build's page script now takes over when the tab is attached again; pages still running a script from 0.7.0 or earlier stop being asked.

**Fixes from a first real test** ([D4](docs/decisions.md#d4-fusion--monotonic-alignment-of-events-to-deictic-words), [D9](docs/decisions.md#d9-source-mapping) and [D14](docs/decisions.md#d14-one-setup-command) notes 2026-09-29)
- Fixed: an element whose text is joined from several children (a section header with its title, a help tooltip and filter tabs with counts) got `text at:` one of the tabs' labels, a descendant's line. Only its own leading text is looked up now: the header gets its `title="…"` line, or no line when that text is written twice. An element with one piece of text is looked up as before.
- Fixed: a gesture made just before speaking, in a long silence, was a "_Pointed at without speaking._" request of its own, followed by the request it was about. A pointing whose gestures all come at most 1 s before the first word of a request said while pointing now joins it, marked before its first word: "[a] y la tarjeta de pedidos [b] hay que…". `requests` format only; the classic format is unchanged.
- Fixed: `pointcast setup` run at the root of a repository whose app is in a subfolder (`web/package.json`, nothing at the root) said no project was found. It now looks one folder down when the folder it runs in has no `package.json` or `manage.py`: "Frontend (react, vite) in web/: nothing to add in development." With several such subfolders it picks none and lists them.

**One entry for list rows that link to different pages** ([D5 note 2026-09-29](docs/decisions.md#d5-html--capture-generously-already-sanitized-render-lean))
- Fixed: 3 or more copies of one component that differ only in their link (`<a href="#/course/algebra">`, `…/calculo`, …) were one entry each, because their `find:` lines differed by `href`. They are now one entry like other copies; the links are listed in letter order on their own line (``href [a–e]: `#/course/algebra`, …``), and a label that differs as the texts do (`«Ver Álgebra»`) likewise. Everything else must still be identical, and pairs are never grouped. Specs without such runs are unchanged.

**Pointing inside SVG charts and maps** ([D7 note 2026-09-29](docs/decisions.md#d7-pointing-gesture))
- Fixed: Alt+click on a bar, point or star of a chart or map drawn in inline SVG captured the whole element around the drawing (a 3254×1568 px `div.map-layer` in a real test), so one star could not be pointed at. It now captures the SVG element when it is content (named by `aria-label`, `aria-labelledby` or a `<title>`, or with a role, a test attribute, a stable id, a link, `tabindex` or its own pointer cursor, or a `<text>` label): `rect «Febrero: 90»`, with a path through the drawing (`svg«Mapa» › g«Álgebra» › circle«Límite de una función»`), its component, and the highlight on the shape itself. A nameless shape inside a named group points at the group, and so does one inside an item marked only by an identifier (`<g data-id="limites">`, also `data-key`, `data-node`, `data-node-id`, `data-name`, `data-slug`), even in an `<svg role="application" aria-label>`: `find:` shows ``data-id `limites` `` and the path `g[data-id=limites]`. Three or more such items drawn by one component are one entry, their identifiers listed like links (``data-id [a–c]: `limites`, `derivadas`, …``).
- Unchanged: icons (`aria-hidden`, inside a button or link, or icon-sized) and nameless drawing still point at the element around them. Path data and other geometry never leave the page; a `<title>` follows the same privacy rules as `aria-label`. Session format: `styles` adds `fill` and `stroke` for SVG elements.

**Spec polish from real sessions** ([D4](docs/decisions.md#d4-fusion--monotonic-alignment-of-events-to-deictic-words), [D5](docs/decisions.md#d5-html--capture-generously-already-sanitized-render-lean) and [D9](docs/decisions.md#d9-source-mapping) notes 2026-09-29)
- Fixed: a group of copies with no text (three SVG stars) read `- [a–c] 3 × → code:`; it now names their tag, `3 × g → code:`.
- Fixed: two different elements with the same selector on the same page (two charts in two tab panels) were rendered as one, "(same element as in request 1)", and the second lost its code lines. They must now also share their path, their card and their code to count as the same element; otherwise each is described in full. The classic format's appendix had the same bug and is fixed too.
- Fixed: an element's card (`in «…»`) could be the title of a closed dialog kept in the page (a command palette's «Command Palette · Search for a command to run...»). Headings the user cannot see (closed `<dialog>`, `hidden`, `inert`, `aria-hidden`, not rendered, screen-reader-only) are skipped.
- Fixed: fields of a shadcn form (react-hook-form) got ``used at: `src/components/ui/form.tsx:37` — `<Controller {...props} />` ``, the same wrapper line for every field. A line that only hands its props on is no longer `used at`: the field's own line in the form, or the form's `<FormField …>` line, is.
- Fixed: after pointing at an element, a longer explanation of it with no new gesture became several requests with no element. The sentences said right after a request (each within 4 s of the previous one, up to 4 sentences and 80 words, until the next gesture) are now quoted inside it, one line each, marked `(continues, no pointing)`; a preamble line explains the marker when a spec has one. The quote and its markers are unchanged.

**Transcription quality: Fast / Accurate** ([D1 note 2026-09-29](docs/decisions.md#d1-transcription--whisper-via-transformersjs-locally))
- New popup setting. **Fast** is the model used so far (`Xenova/whisper-base`, the default). **Accurate** uses `Xenova/whisper-small`: fewer misheard words (96 % of the Spanish test recording's words instead of 93 %), about twice as slow, and a 512 MB download the first time it is used, shown in the popup like the first download. Still transcribed on your computer, from the same host; no new permission.
- The time estimate and the first-download notice are kept per model, so switching does not reuse the other model's numbers. `words.json` names the model used.
- CLI: `--model Xenova/whisper-small` is the same Accurate model, at the same precision (fp32 encoder, q8 decoder); `pointcast --help` lists both.

**The MCP server as the main path** ([D11 note 2026-09-29](docs/decisions.md#d11-handoff-to-a-running-mcp-server))
- `list_sessions` says what each recording is: the pages pointed at (`host/path`, three at most), how many `requests` and `elements`, a `preview` of the first request (~80 characters), `matchesProject` (whether the recording's source files are in the project: `true`, `false` or `"unknown"`, the check behind `get_session`'s other-project warning) and `rendered` (its `session.md` is on disk). It takes a `repo` argument like the other tools, and answers with one session per line. The absolute `dir` of each session is no longer listed.
- New session id `"latest-here"` for `get_session` and `get_element`: the newest recording made on this project. It passes over newer recordings whose source files are all missing from the project (and says which, above the spec), takes one that names no files (it cannot tell), and falls back to the newest recording, with a note, when none of the 20 newest is from here. `"latest"` is unchanged. `/pointcast` without an argument now uses `"latest-here"`.
- The line above a spec (`get_session`) and after `pointcast process` says what the recording holds in plain terms: `8 requests · 17 elements · ~3,100 tokens` instead of `17 events (10 deictic, 6 time, 1 standalone) · 12322 chars · ~3081 tokens`. A spec on disk with no `words.json` gets the same line instead of "session.md read from disk".
- Helpful errors: an unknown session id names the 3 newest recordings with the start of their first request, and suggests `list_sessions` (instead of "No session.json in …"); an unknown event id gives the valid range, `e1…e17`.
- New tool `wait_for_recording`: waits for the user's next recording and returns its spec, as `get_session` does (with the other-project warning), as soon as the extension hands it over at Stop. After `timeoutSeconds` it answers "No new recording yet … call wait_for_recording again to keep listening", which is not an error. The default fits the client's own limit for a tool call: 9 minutes for Claude Code and Gemini CLI, 50 s for others (Codex stops tool calls after 60 s by default); at most 25 minutes. It sends progress notifications while waiting when the client asks for them. It works with several agent sessions open: the server that does not hold the handoff port watches the sessions folder, and a recording saved by Chrome's downloads is taken once its files are complete. A recording made while the agent was busy is returned by the next call; one already read with `get_session` is not returned again. By default it returns only recordings made on this project (the `"latest-here"` rule: skipped when its source files are all missing here, kept when it names none), so two agents watching two projects each get their own; a skipped recording stays new for the other one. `anyProject: true` returns every recording.
- `/pointcast watch` (Claude Code and Codex skill, Gemini CLI command): the agent says it is listening, then loops: wait for a recording, apply it with the usual rules (it stops on the other-project warning and asks when a request is ambiguous), report one line per request, wait again, until you tell it to stop. It only picks up recordings made on the project it runs in.
- Experimental: the MCP server declares a Claude Code [channel](https://code.claude.com/docs/en/channels-reference). A Claude Code session started with `--dangerously-load-development-channels plugin:pointcast@pointcast` (pointcast is not on the preview's allowlist) is told when the extension hands its server a recording: "New pointcast recording <id>: 3 requests on localhost:5173/orders. Apply it with the pointcast tools…". Only the id, counts and pages, never the spec. Nothing changes for anyone who does not start Claude Code that way, and other clients get no message.
- README: the Quick start leads with the agent integration (`/pointcast`, `/pointcast watch`), with pasting as the fallback; new FAQ entry "How do I turn it off for a project or a session?". The CLI README documents the new tools and the default waits per client, and its MCP snippets pin `pointcast@0.7` instead of the outdated `0.2`. The popup setting is named as the popup shows it, *Send to your agent's Pointcast MCP server*.
- `pointcast doctor`: when a pointcast MCP server holds the handoff port, it adds a note that every agent session starts its own server and they all read the same sessions folder, so it works whichever one receives; when that server is older than the CLI, it says it is probably a session started before the update, and to close or restart those sessions so the new version receives.

## 0.7.0 (2026-09-28)

Extension, CLI and integrations at 0.7.0.

**Fixed: words of side-by-side elements no longer run together** (thanks @okdanko0520, #14)
- Texts of sibling elements laid out apart (flex or grid items, inline-blocks: a nav label and its badge, a date chip's two lines) read with a space between them, "Messages 3" instead of "Messages3". Inline siblings still read as one word ("$45"). Fixes #3.

**Resolver pass 2: fewer wrong lines, more right ones** ([D9 note 2026-09-28](docs/decisions.md#d9-source-mapping))
- Fixed: on React 19 + Vite, an element written straight in a page that a router renders (`createFileRoute(…)({ component: Dashboard })`) got the router's `<Outlet />` layout as `used at`, a wrong file, and no `text at`. Its code is now the page's own file, and the line is found (`dashboard/index.tsx:81` in shadcn-admin).
- Fixed: a text written once in the file that uses a component, and also in that component's own file or its data (a page-title switch and the nav item's label), no longer gets the usage file's line. It is silent, or the nav entry's line when the link's href is written once.
- React 19 on Vite: the element's own component file is recorded (the file its JSX is written in, no line), so the spec says `defined in:` for an element inside an app component, marked shared when its text is written elsewhere. Vue's component file gives the same line.
- A text written more than once in the component files is told apart by the element's own component or tag (`<CardTitle>Overview</CardTitle>` for a card title, not the tab or the nav data), and stays silent when it cannot be told.
- New `class at:` / `id at:` lines for elements with no text of their own: a distinctive class or id written once, on the element's own tag. Session format: `resolved[].kind` can be `"class"` or `"id"`.
- `find:` no longer lists utility classes (`transition-all`, `ring-sidebar-ring`); `styles:` rounds pixel lengths to whole pixels. Colors stay as they are.
- CLI and MCP server: when the app is a subfolder of the project folder (`web/` inside the repository), every path in the spec and in `get_element` is shown from the project folder (`web/src/…`), so it opens as written. Unchanged when no single subfolder holds the recording's files.
- On shadcn-admin's six-change set: `text at` on 4 of 6 elements (was 2), no wrong line (was one wrong `used at`). Stage 0's 15 lookups are unchanged; the Vue, Svelte and Django sets only get rounded `styles:`.

**Code pointer on Next.js App Router** ([D9](docs/decisions.md#d9-source-mapping), [results](docs/eval/nextjs-2026-09-28.md))
- Fixed: on Next.js (React 19, Turbopack dev), 0.6.0 named Next's build chunks as your code (``used at: `_next/static/chunks/14ei_next_0os_t-p._.js` ``) and gave Server Components no code at all, with Next's internal `SegmentViewNode` as their component.
- Client and Server Components now get their real chain, with lines: React 19's owner stacks are mapped through Next's own dev source maps (a chunk's `.map`, and `/__nextjs_source-map` for Server Components), in the page, right after the gesture. Only paths inside your project and line numbers leave the page. A frame that cannot be mapped ends the chain rather than letting the next one take its place. On a 13-element example app: 13/13 chains right, where 0.6.0 had 6 wrong and 7 missing.
- A page's or layout's own markup (an `<h1>` written in `app/page.tsx`) gets its own line as its code: `used at: app/page.tsx:10`.
- The resolver (CLI, MCP server) finds text a Server Component renders from a data module it imports (`customer: "Jackson Lee"` in `lib/data.ts`), follows `@/` through `tsconfig.json` when the project has no `src/`, and ignores Next's `metadata` export (it fills the page title, not the page). Each is silent when ambiguous; Stage 0's 15 lookups are unchanged.
- Not covered: `text at:` lines in the pasted spec (Next's dev server serves no source; the MCP server and CLI read your repo), `next dev --webpack`, a custom `distDir`.
- Session format: `renderedBy: []` means "read, and no app component above the element"; readers that ignore it are unaffected.
- `dev/examples/next-dashboard`: the example app (Next.js 16, installed on its own, outside the workspace), with its ground truth; `dev/eval/typed/record.mjs --tasks-file dev/eval/typed/next-tasks.json` records it headlessly.

**`shown by:` — where a value from data is displayed** ([D9 note 2026-09-28](docs/decisions.md#d9-source-mapping))
- When an element's text comes from a data literal (`customer: "Marco Peña"`), the spec now also says which line renders that field: `shown by: src/components/OrdersTable.tsx:38` — `<td>{order.customer}</td>`. `text at:` / `data at:` still point at the value, for changing it; `shown by:` points at the markup, for changing how it is shown (link it, format it, badge it).
- Recognizes `{x.key}`, `{key}`, `{x?.key}` and `{@html x.key}` (React, Svelte) and `{{ x.key }}` with filters (Vue, Django, Jinja) as element content, in the component files already searched, innermost first. No key, no such rendering, or two of them: no line. Nothing else in the spec changes.
- New optional session field `element.shownBy` ([session-format.md](docs/session-format.md#elementinfo)), also returned by the MCP `get_element` tool and linked by `pointcast issue`. The `/pointcast` skill and Gemini command say when to use the line.

**macOS and Linux: tested in CI, Option+click named as such**
- The end-to-end suite now runs in CI on macOS and Windows as well as Linux (Chromium, headless): Linux and macOS on every pull request, Windows on `main` after a merge, all three by hand (`workflow_dispatch`). The unit tests run on all three. The README no longer calls macOS and Linux untested.
- Two tests fixed for macOS and Windows runners: the note-box test moved the caret with End, which macOS does not do (⌘↓ does), and GitHub's Windows runners get more room in the gesture-timing check, which measures the test harness, not Pointcast.
- On macOS the popup says **⌥ Option+click** instead of Alt+click (Chrome maps Alt to Option there; the gesture is the same). `pointcast setup` and the README mention it too.
- New e2e test (`dev/e2e/alt-click-defaults.spec.ts`): while recording, Alt/Option+click on a link, a link with `download`, a submit `<button>`, an `<input type=submit>` and links inside open and closed shadow roots only points. Nothing is followed, downloaded or submitted, and Alt+middle-click opens no tab. A control run without recording shows Chrome downloading the link, and downloading the form's response too. The typed-mode note box is checked with Alt/Option still held when it opens, and with Option+Enter.

**Tighter specs: what you say without pointing stays with its request, copies of one component are one entry** ([D4 note](docs/decisions.md#d4-fusion--monotonic-alignment-of-events-to-deictic-words), [D5 note](docs/decisions.md#d5-html--capture-generously-already-sanitized-render-lean) of 2026-09-28)
- A sentence said without pointing no longer becomes a request of its own when the times tie it to its neighbour: a follow-up said within 4 s of a request with gestures is appended to its quote ("… chips de aquí [e]. no me gustan …"), what you say within 6 s of pointing in silence becomes that pointing's quote ("[a] y hay que arreglar …"), and a short unfinished lead-in cut by a pause ("Luego en Proceso,") joins the request after it. At most one sentence per request, at most 20 words; anything else stays a request of its own. The quote keeps your words as spoken.
- 3 or more consecutive elements of one request that are copies of one component (same code lines, card, styles and page; paths differing in one index) render as one entry: `- [c–i] 7 × «Sem 2 …», «Sem 3 …», … → code:`, the shared lines once and `in: main › ul › li[1..7]`. A line that differs (the HTML) is listed per element as `[d] html: …`. A preamble line explains the entry, only in a spec that has one.
- `requests` format only; the classic format and the session format are unchanged. Specs without such cases are byte-identical.

## 0.6.0 (2026-09-28)

Extension, CLI and integrations at 0.6.0. The CLI package now declares `mcpName` (`io.github.Hugelidus/pointcast`) for the MCP Registry.

**`pointcast setup`: one command, whatever your agent and stack** ([D14](docs/decisions.md#d14-one-setup-command))
- `npx pointcast@latest setup`, run in your project, finds Claude Code, Codex, Gemini CLI and Cursor and adds Pointcast to each one its documented way: the plugin for Claude Code and Codex, the extension for Gemini CLI, the MCP server (pinned to the CLI's exact version) in the project's `.cursor/mcp.json` for Cursor, merged with the servers already there. Agents that already have it are skipped.
- It says what your stack needs: the `pointcast-django` install line and the `INSTALLED_APPS` line for a Django project (your Python files are never edited), and that React, Vue and Svelte dev builds need nothing. It prints how to add the browser extension, then runs `pointcast doctor`.
- Asks `y/N` before each change and shows the exact command or file first. `--yes` accepts all, `--dry-run` shows the plan only, `--json` reports for agents. Without a terminal and without `--yes` it is a dry run.

## 0.5.0 (2026-09-28)

Extension, CLI and integrations at 0.5.0.

**Debug capture: the errors around what you point at** ([D13](docs/decisions.md#d13-debug-capture))
- While you record, Pointcast keeps what fails on the page: uncaught errors and unhandled rejections (message, file:line, first stack lines), `console.error` and `console.warn`, and requests that fail or answer 400+ (method, path, status). When you point at something broken, the spec lists the errors from 5 s before to 3 s after, under the element: ``- network: `POST /api/export` → 500 (0.6 s before)``, ``- uncaught: `TypeError: …` at `src/OrdersTable.tsx:31` ``. Nothing is added when nothing failed.
- Works in voice and typed mode, on local dev hosts and on sites you enabled, and on pages loaded during the recording. The page is only hooked while recording, and its behaviour is unchanged.
- Privacy: never a request or response body, a header or a query value; sensitive field values are replaced everywhere; on enabled sites personal data is redacted as in the page text. Popup → Settings → *Capture console and network errors* (on by default) turns it off. See [PRIVACY.md](PRIVACY.md).
- Session format: events and `session.json` gain an optional `errors` list (`schemaVersion` stays 2). `pointcast process`, `get_session` and `get_element` read and render them; older sessions and readers are unaffected.
- Playground: `dev/playground/errors.html`, a page of broken buttons.

**Code pointer: library code stays out of the spec** ([D9](docs/decisions.md#d9-source-mapping))
- The `find:` line names a library component by its package, never by its node_modules path: ``component `TabItem` (svelte, package `flowbite-svelte`)`` instead of ``… in `node_modules/.pnpm/flowbite-svelte@…/dist/tabs/TabItem.svelte:42` ``. Older sessions render this way too.
- Library wrappers (Radix's Primitive, Slot, SlotClone, Presence, Portal…) are skipped before the chain's cap of 3 frames, so the places go to your app's own components, in capture (React, Vue, the bridge) and in rendering.

## 0.4.0 (2026-09-28)

**Typed mode: type instead of talking** ([D12](docs/decisions.md#d12-typed-mode))
- The popup has a **🎤 Voice / ⌨️ Typed** choice above Record, remembered for the next recordings. Typed never opens the microphone: no permission page, no speech model download, no audio.
- While recording in Typed mode the pill says **● Notes**, and each Alt+click (or text selection) opens a small note box next to the element: Enter saves, Shift+Enter starts a new line, Esc drops that gesture, a click outside saves what you typed (or drops an empty box), and pointing at the next element (Alt+click or a selection) saves the open one. Keys typed into the box never reach your app, and its scripts cannot read the note. The box also works inside modal dialogs and focus-trapped panels.
- Stop turns the notes into the spec right away, with the same result as a voice recording: copied, sent to your agent's MCP server or saved to Downloads, and announced in the popup. Each note becomes a request (`> This button should export only the filtered orders. [a]`) followed by its element and code pointer as before.
- Session format: `session.json` gains an optional `inputMode` (`"typed"`) and events an optional `note`. Both are optional, so older sessions and readers are unaffected. A typed session has no `words.json` or audio; `pointcast process`, `get_session` and `pointcast issue` render it from its notes without transcribing.

## 0.3.0 (2026-09-28)

Extension, CLI and integrations at 0.3.0.

**Django templates get the code pointer** ([integrations/django](integrations/django/README.md))
- `pointcast-django`, one line in `INSTALLED_APPS` under `DEBUG`: in development it marks each rendered template (includes, HTMX partials, blocks inherited from a base template) with invisible HTML comments. It never changes production output, JSON, text emails, attributes or `<title>`, and never writes an absolute path.
- The extension reads the markers when you Alt+click, and the resolver finds the element's text in its template: `text at: templates/pim/partials/row.html:42`. It searches the innermost template first, prefers the hit in the element's own tag, and ignores `<script>`, attribute values, template comments and `{% if %}` operands. On a real 1,358-template Django + HTMX app it placed ~94 % of sampled elements on their exact line, with no wrong answer; the rest stay silent.

**CLI**
- `pointcast doctor`: checks your setup in a few lines (Node, the sessions folder, whether an MCP server is receiving recordings, local transcription, the Linux clipboard) and says how to fix each problem. `--json` for agents, `--online` to compare with npm.
- Releases are built by CI from a version tag, as a draft with the zip, the CLI package and checksums ([CONTRIBUTING](.github/CONTRIBUTING.md)).

## Extension 0.2.2 (2026-09-28)

A usability pass on everything the extension says and shows. The CLI and the integrations are unchanged (0.2.1).

**Popup**
- A result reads as a result: a success headline ("Copied. Paste it into your agent."), then where it went on its own line (Downloads › pointcast, or your agent's Pointcast MCP server, with the whole folder on hover and a *Copy path* button), then the audio length and the number of events. A warning is its own amber block and never looks like an error; an error says in its first sentence what failed and what to do, with the raw message folded under *Details*.
- The first recording is announced before it happens: while the microphone is not allowed, the main button is *Allow microphone* and opens the permission page; while the speech model was never downloaded, a notice says the first recording downloads it once (294 MB, one figure everywhere). After Stop, a first run reads "Preparing…" instead of a made-up estimate.
- While a recording is processed, Record, the tab line and the site section step aside; the Time and Events cards show only while recording, and every duration reads m:ss.
- Gestures are named in words: "Last: link “View report”", "Undone: column header “Quantity”", the same in the popup and in the page.
- On a remote site that is not enabled, *Enable on <host>* is the first step and Record says the tab won't be captured.
- New look: ink and violet brand colours, stronger contrast in light and dark, violet for processing and amber for warnings only; the shortcuts are drawn as keys.
- Screen readers hear each change of stage, headline, warning or error once (never the countdown); the progress bar is a progressbar; the focus stays on a usable control when the one pressed goes away.

**In the page**
- The pill says where the recording went ("✓ Copied · saved to Downloads" or "sent to your agent"), shows a warning in amber and a failure with ✗, and says so when Record failed (for example a denied microphone).
- New pill style (ink background, one coloured glyph), a violet capture ring instead of the error red, and `prefers-reduced-motion` is honoured.

**Failures you can act on**
- Known transcription failures (the model download, not enough memory, too long) come out as one sentence that says what to do, and every one says that the events and audio are saved. The notification carries that sentence only.
- A failed Record shows "!" on the toolbar icon, and a denied microphone opens the permission page, which now brings you back to the tab you came from. The permission page is rebuilt: numbered steps when the microphone is blocked, *Check again*, *Back to my app*.
- Fixed: a retried report could download a session's files twice. Fixed: when the service worker could not take the processed recording, the popup stayed on "Processing…" for up to 10 minutes; after five tries (about 30 s) it now says what was kept (the Markdown on the clipboard, or the files with your agent's MCP server).
- Plain words instead of internal ones in every message, "Pointcast" written the same way everywhere, and every Whisper language named in the language menu.

**Repository**
- The README is rewritten around a one-line install per agent (Claude Code, Codex, Gemini CLI, Cursor and any MCP client) and the evaluation numbers, each linked to its report; setup and development moved to CONTRIBUTING.md.
- A code of conduct (Contributor Covenant 2.1), issue forms instead of Markdown templates, and a demo script built on the React example.

## 0.2.1 (2026-09-28)

CLI 0.2.1, extension 0.2.1 and the integrations at 0.2.1.

**Transcription you can trust**

- Silence and room noise no longer turn into invented words ("¡Adiós!", "Gracias.", "Thank you."). A voice activity detector (Silero VAD, 2 MB, downloaded once like the Whisper model) finds the speech first, and only the speech is transcribed.
- Whisper can no longer loop for pages: its output is limited to what the audio's length allows, a phrase repeated three times or more is kept once, and words with impossible times are dropped.
- When part of a transcript had to be dropped as unreliable, the spec says where in one line, and the popup and the CLI warn. `words.json` gains an optional `unreliable` field ([session format](docs/session-format.md#words)).
- The CLI ships an `npm-shrinkwrap.json`: every dependency version is locked, so the MCP server the plugins start is exactly the reviewed one. The plugins start `pointcast@0.2.1`.

## 0.2.0 (2026-09-28)

Extension 0.2.0, CLI 0.2.0 (`pointcast` on npm), and the Claude Code, Codex and Gemini CLI integrations at 0.2.0.

**Recordings go straight to your agent's MCP server** ([D11](docs/decisions.md#d11-handoff-to-a-running-mcp-server))
- While a pointcast MCP server runs (the plugin, or `npx -y pointcast@0.2 mcp`), the extension hands it each recording after Stop, and the server stores it in the sessions folder its tools read. Chrome downloads nothing, so no Save dialog appears, even with "Ask where to save each file" on.
- With no server running, recordings are saved by Chrome's downloads exactly as before, silently. When a server answers but does not take the recording, Chrome's downloads save it and the popup says why in one line. A recording is never lost.
- Only the pointcast extension can send recordings: the server listens on `127.0.0.1` only and checks the host, the extension's origin, a custom header and the content type. Other extension ids (forks, Edge Add-ons until its id ships): `POINTCAST_EXTENSION_IDS`.
- On both sides by default, with switches: the popup's *Send to a running pointcast MCP server*, and `pointcast mcp --no-handoff` / `POINTCAST_HANDOFF=off` (for shared multi-user computers).
- The popup shows the folder the server stored the recording in; *Show in folder* is for downloaded recordings only.

**Extension**
- Every build has the same extension id, the Chrome Web Store item's: the release zip, `pnpm build` and the e2e build carry its public key as the manifest `key`, and the store uploads (`pnpm --filter @pointcast/extension zip:store`) leave it out. Updating an unpacked install no longer changes the id, so the speech model is no longer downloaded again after each update.
- **One-time step for unpacked 0.1.x installs:** remove the extension and load 0.2 as a new one. Its id changes this once: allow the microphone again, and the speech model downloads once more.
- Works in Microsoft Edge (checked in Edge 154). Other Chromium browsers load the same extension, untested.
- Fixed: after processing, the popup's *Time* went back to 00:00. It now keeps showing the finished recording's length until the next Record.

**CLI and MCP server**
- `pointcast mcp` receives recordings from the extension (above). It logs to stderr only.
- `list_sessions` returns `{ "sessions": [...] }` instead of a bare array (Gemini CLI requires an object), and all three tools are annotated read-only.
- Folders starting with `.` (deliveries in progress) are ignored, and `get_session` refuses such ids.
- On Linux, the Downloads folder is read from xdg-user-dirs (`XDG_DOWNLOAD_DIR`, e.g. `~/Descargas` on a Spanish desktop), where Chrome saves, instead of always `~/Downloads`.

**Integrations**
- Codex CLI: the Claude Code plugin is also a Codex plugin (`codex plugin marketplace add Hugelidus/pointcast`, then `codex plugin add pointcast@pointcast`); `$pointcast:pointcast`, or ask to apply your latest recording.
- Gemini CLI: the repository is a Gemini CLI extension (`gemini extensions install https://github.com/Hugelidus/pointcast`) with the MCP server and `/pointcast`.
- The plugins start `pointcast@0.2` instead of an unversioned `pointcast`, which `npx` kept on a cached 0.1.0. All MCP snippets in the docs follow.
- The `/pointcast` skill's text is shared by Claude Code, Codex and Gemini CLI.

## Extension 0.1.2 (2026-09-28)

- The extension's name is "Pointcast", capitalized, in the Chrome Web Store, `chrome://extensions` and the toolbar tooltip.

## Extension 0.1.1 (2026-09-28)

- New logo, drawn for every size: a pointer casting voice waves ("point" + "cast"), with a simplified 16 px version for the toolbar.
- Prepared for the Chrome Web Store: listing, screenshots, promo tiles and a [privacy policy](PRIVACY.md). The CLI is unchanged (0.1.0).

## 0.1.0 — public beta (2026-09-27)

The first public release. Chrome extension, CLI and MCP server (`pointcast` on npm), and a Claude Code plugin.

**Record**
- Record your voice while you **Alt+click** or select the elements you are talking about, on local dev hosts (`localhost`, `127.0.0.1`, `*.localhost`, `*.test`) or on any site you enable, one host at a time.
- Undo the last gesture (popup or Alt+Shift+U); start and stop with Alt+Shift+S.
- Privacy by default: an attribute allowlist, sensitive fields never captured, personal data redacted on non-local sites, project-relative paths only.

**Transcribe and fuse, in the browser**
- Whisper (`Xenova/whisper-base`) runs locally with transformers.js, while you record: the spec is on the clipboard a few seconds after Stop.
- One request per sentence you said, with the elements you pointed at while saying it.

**Point at the code**
- On React, Vue 3 and Svelte 5 dev builds, each element leads with its code: where that instance is used, the component that defines it (marked when shared), and the line of its text or data, with the source line quoted.
- Resolved from the page's own Vite dev server at Stop, or from your local repository through the MCP server, the Claude Code plugin (`/pointcast`) and `pointcast process`.
- A short value (a badge, a count, a number in a table) is found through the item it belongs to: the «3» next to «Messages» leads to `badge: 3` in the Messages entry of the nav data.
- Silence over guesses: nothing is added when a text is written more than once.

**Integrations**
- MCP server (`pointcast mcp`): `list_sessions`, `get_session`, `get_element`.
- Claude Code plugin with a `/pointcast` command that fetches the latest recording and applies it.
- The CLI installs in seconds (about 25 MB): local transcription in Node, needed only to transcribe a recording again, loads `@huggingface/transformers` as an optional peer dependency.
- If Chrome's "Ask where to save each file" setting scatters a recording's files, the popup says so, and the CLI and the MCP server skip its empty session folder instead of failing.
- `pointcast issue` (experimental): file a recording as a GitHub issue with permalinks.

Known limitations: see the [README](README.md#known-limitations-of-the-beta).
