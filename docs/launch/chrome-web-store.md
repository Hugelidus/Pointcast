# Chrome Web Store listing

Everything the [developer dashboard](https://chrome.google.com/webstore/devconsole) asks for, tab by tab, ready to paste. Images are in [store/](store/) (regenerate them with `node docs/launch/store/render.mjs`; the icon with `node scripts/icon/render.mjs`).

## Package

Upload `pointcast-<version>-chrome-store.zip`: `pnpm zip:store` in `packages/extension` (from the repository root, `pnpm --filter @pointcast/extension zip:store`) writes it to `packages/extension/.output/`. Store builds leave out the manifest `key`: the store item has its own id, and the store sets it.

Do not upload the GitHub release zip (`pointcast-<version>-chrome.zip`, from `pnpm zip`). It, and every other non-store build (`pnpm build`, `pnpm dev`, the e2e build), carries the store item's **public** key as the manifest `key` (`EXTENSION_PUBLIC_KEY` in `packages/core/src/handoff.ts`), so an unpacked install gets the same id as the store's. That id is what a pointcast MCP server accepts recordings from (`OFFICIAL_EXTENSION_IDS`, [D11](../decisions.md#d11-handoff-to-a-running-mcp-server)). The public key is shown in the dashboard under *Package*; nothing is signed with it.

The same store zip goes to Microsoft Edge Add-ons: [edge-addons.md](edge-addons.md).

The store's summary line is the manifest's `description` (`packages/extension/wxt.config.ts`), not a form field:

```
Talk and point at your web app: your coding agent gets a spec with the exact elements and the code behind them.
```

## Store listing

**Description:**

```
Talk about the UI change you want while you Alt+click the parts of your web app you mean. pointcast turns it into a Markdown spec your coding agent can act on: what you said, the exact elements you pointed at, and the code behind each one.

HOW IT WORKS
1. Press Record and talk, the way you would to a colleague: "this should take you to the reports page", "this button should export the order status".
2. Alt+click (or select) whatever you are talking about as you say it. Pointing never triggers the page: Alt+click on "Delete" never deletes.
3. Press Stop. A few seconds later the spec is on your clipboard: one request per sentence, each with the elements you pointed at while saying it. Paste it into Claude Code, Cursor or any coding agent.

IT POINTS AT THE CODE
On development builds of React, Vue 3 and Svelte 5, each element leads with its code: where that instance is used, and the line of its text or data in your source, quoted. Your agent goes straight to the right line instead of searching the codebase. With the companion plugins for Claude Code, Codex and Gemini CLI, your agent fetches the recording itself and resolves it in your repository; while it runs, recordings go straight to it instead of your Downloads folder.

PRIVATE BY DEFAULT
- Your voice is transcribed on your device: Whisper runs inside the extension. No account, no server, no API key.
- Works on local development hosts (localhost, 127.0.0.1, *.localhost, *.test) out of the box. Any other site needs your explicit opt-in, one site at a time.
- Password fields and other sensitive inputs are never captured. On non-local sites, text that looks like personal data (emails, phone numbers, tokens) is redacted.
- Open source (MIT): https://github.com/Hugelidus/pointcast

WHY POINTING HELPS
In an evaluation on three real open-source dashboards (React, Vue, Svelte), pointing raised the share of requests where the agent found the right element from 78% to 89%, exactly where words alone are ambiguous: two "Export" buttons, identical cards, shared components. Pointing at the code then cut the tokens the agent spent finding the elements by more than half. Methods and numbers are in the repository.

This is a beta: feedback and bug reports are welcome at https://github.com/Hugelidus/pointcast/issues
The first recording downloads the speech model once (about 291 MB).
```

- **Category:** Developer Tools
- **Language:** English
- **Store icon:** `store/icon-128.png`
- **Screenshots (1280x800):** `store/screenshot-1.png` … `store/screenshot-4.png`
- **Small promo tile (440x280):** `store/promo-small.png`
- **Marquee promo tile (1400x560):** `store/promo-marquee.png`
- **Homepage URL:** https://github.com/Hugelidus/pointcast
- **Support URL:** https://github.com/Hugelidus/pointcast/issues

## Privacy practices

**Single purpose:**

```
Records the user's voice and the elements of their own web app that they explicitly point at (Alt+click or text selection), and turns them into a text spec for a coding assistant, with the source code location of each element when the app is a development build.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the recording state (idle, recording, processing) in chrome.storage.session so it survives the service worker being suspended, and the user's settings (language, keep audio, notifications, sending to the user's own pointcast MCP server) in chrome.storage.local. |
| `offscreen` | MV3 service workers cannot record audio. The offscreen document holds the microphone recording from Record to Stop and runs the local speech-to-text model. |
| `downloads` | Saves each recording's files (session.md, session.json, words.json) under a pointcast folder in the user's Downloads folder when they press Stop, unless a pointcast MCP server runs on the same computer, which then stores them. It is the only way an extension can write files to disk. |
| `scripting` | Injects the capture script into tabs that were already open when the extension was installed or updated, and registers it on the sites the user enables one by one from the popup. It never runs on a site the user has not enabled. |
| `notifications` | Tells the user when a recording has been processed and copied, if they looked away. Can be turned off in the settings. |
| `alarms` | A safety timeout: if the browser suspends the extension while a recording is processed, an alarm ends the stuck state and saves what was recorded. |
| `unlimitedStorage` | Caches the local speech model (about 291 MB) so it is downloaded only once. |
| `activeTab` | Lets the popup read the current tab's address when the user opens it, to show whether that tab is captured and offer "Enable on <site>" for it. |
| Host permissions: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test` | The core use: recording the user's own app while they develop it. The capture script and the on-page recording indicator run on these local development hosts only. The extension also uses `127.0.0.1` to hand a recording to the user's own pointcast MCP server (the companion command-line tool, running on the same computer) instead of downloading it. |
| Optional host permission: `*://*/*` | Not requested at install. Granted one site at a time, only when the user presses "Enable on <site>" in the popup (for a staging server or a preview deployment); Chrome asks the user first, and "Remove <site>" revokes it. |

**Remote code:** No, I am not using remote code. (The speech model downloaded from Hugging Face is data: model weights. All code, including the ONNX Runtime WebAssembly, ships in the package.)

**Data usage** — nothing is transmitted to the developer or third parties, but the extension handles, on the user's device:
- **Website content** (the text and HTML of the elements the user points at);
- **User activity** (the Alt+clicks and text selections that point at them);
- **Personal communications** (the user's voice, transcribed locally).

Declare these three, then certify: not sold or transferred to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/Hugelidus/pointcast/blob/main/PRIVACY.md

## Distribution

- **Visibility:** *Unlisted* during the beta (installable by anyone with the link, not listed in search); switch to *Public* later.
- **Regions:** all.
- **Price:** free.
