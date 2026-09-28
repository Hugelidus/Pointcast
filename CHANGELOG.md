# Changelog

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
