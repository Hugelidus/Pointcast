# Chrome Web Store listing

Everything the [developer dashboard](https://chrome.google.com/webstore/devconsole) asks for, tab by tab, ready to paste. Images are in [store/](store/) (regenerate them with `node docs/launch/store/render.mjs`; the icon with `node scripts/icon/render.mjs`).

## Package

Upload `pointcast-<version>-chrome.zip` (`pnpm zip`, in `packages/extension/.output/`; also attached to each [GitHub release](https://github.com/Hugelidus/pointcast/releases)).

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
On development builds of React, Vue 3 and Svelte 5, each element leads with its code: where that instance is used, and the line of its text or data in your source, quoted. Your agent goes straight to the right line instead of searching the codebase. With the companion Claude Code plugin, your agent fetches the recording itself and resolves it in your repository.

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
| `storage` | Keeps the recording state (idle, recording, processing) in chrome.storage.session so it survives the service worker being suspended, and the user's settings (language, keep audio, notifications) in chrome.storage.local. |
| `offscreen` | MV3 service workers cannot record audio. The offscreen document holds the microphone recording from Record to Stop and runs the local speech-to-text model. |
| `downloads` | Saves each recording's files (session.md, session.json, words.json) under a pointcast folder in the user's Downloads folder when they press Stop. It is the only way an extension can write files to disk. |
| `scripting` | Injects the capture script into tabs that were already open when the extension was installed or updated, and registers it on the sites the user enables one by one from the popup. It never runs on a site the user has not enabled. |
| `notifications` | Tells the user when a recording has been processed and copied, if they looked away. Can be turned off in the settings. |
| `alarms` | A safety timeout: if the browser suspends the extension while a recording is processed, an alarm ends the stuck state and saves what was recorded. |
| `unlimitedStorage` | Caches the local speech model (about 291 MB) so it is downloaded only once. |
| `activeTab` | Lets the popup read the current tab's address when the user opens it, to show whether that tab is captured and offer "Enable on <site>" for it. |
| Host permissions: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test` | The core use: recording the user's own app while they develop it. The capture script and the on-page recording indicator run on these local development hosts only. |
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
