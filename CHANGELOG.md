# Changelog

## 0.5.0 (unreleased)

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
