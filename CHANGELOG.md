# Changelog

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
