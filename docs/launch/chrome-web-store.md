# Chrome Web Store listing (draft)

Not submitted yet — Phase 1 ships as a loadable zip (README install option A). This is the draft for when the listing goes up.

## Short description (≤ 132 chars)

```
Narrate UI changes while you Alt+click or select elements. Get a Markdown spec your coding agent can act on — transcribed locally.
```
(131 chars)

## Long description

```
pointcast turns "make this sortable and move this next to that" into something your coding agent can actually use.

Press Record and talk about the UI change you want, the way you normally would. Alt+click or select whatever you're
talking about as you say it — pointing never triggers the page's own action, so Alt+click on "Delete" never deletes.
Press Stop: pointcast transcribes your voice locally in the browser (no audio leaves your machine), lines up your
words with the elements you pointed at, and copies a Markdown spec to your clipboard — one request per sentence,
each with the DOM selector, a readable element path, and the source file/line when your dev build exposes it. Paste
it into Claude Code, Cursor, or any coding agent.

WHY POINTING HELPS
An independent evaluation across three real open-source codebases (React, Vue, Svelte) found that giving a coding
agent the same spoken request with pointing data raised correct-element identification from 78% to 89%, concentrated
exactly where plain narration is ambiguous: duplicate buttons, identical cards, shared components. Full methodology
and numbers are published in the project's repository.

PRIVACY BY DESIGN
- Runs only on local development hosts (localhost, 127.0.0.1, *.localhost, *.test) out of the box. Any other site
  needs an explicit, one-host-at-a-time opt-in from the popup — pointcast never asks for access to "all sites."
- Audio and transcription stay on your device by default (a local Whisper model runs inside the extension). No
  account, no server, no API key required.
- Password fields and other sensitive inputs are never captured. On sites you explicitly enable, text that looks
  like personal data (emails, phone numbers, tokens in URLs) is redacted automatically.
- Only a fixed allowlist of HTML attributes is ever captured — nothing unforeseen leaks through.
- Open source (MIT) — read exactly what it does: <GitHub link>.

WHO IT'S FOR
Developers who use an AI coding agent for UI work and are tired of re-explaining which element they mean.

Phase 1: Chrome only. Source-location mapping today covers what your dev build already exposes (e.g. React/Vue/
Svelte in development); a broader Phase 2 is in progress.
```

## Permission justifications (single purpose + each permission)

**Single purpose statement:**
> Records the user's voice and the on-page elements they explicitly point at (Alt+click or text selection) on their own local development site, and turns that into a text spec for a coding assistant. No data leaves the user's device by default.

| Permission | Why pointcast needs it |
|---|---|
| `storage` | Holds the recording state machine (idle/recording/processing) in `chrome.storage.session` so it survives the service worker being suspended, and user settings (language, keep-audio, notifications) in `chrome.storage.local`. |
| `offscreen` | MV3 service workers cannot use `MediaRecorder` or hold a long-lived audio session. The offscreen document is the only extension context that can access the microphone and stay alive for the whole recording. |
| `downloads` | Saving the session (`session.md`, `session.json`, `words.json`) is the only way an extension can write files to disk; they're written under a `pointcast/` subfolder of the browser's own Downloads folder, at the user's request when they press Stop. |
| `scripting` | Injects the capture content script into tabs that were already open before the extension was installed, updated or reloaded (Chrome does not do this automatically), and registers the script on sites the user has explicitly enabled via "Enable on \<host\>". Never runs on a site the user hasn't opted into. |
| `notifications` | Optional (user setting, off is fine): tells the user recording finished processing when they've looked away from the tab. |
| `alarms` | Used only as a timeout safety net: if the browser suspends the extension mid-processing, an alarm (which can wake a suspended worker, unlike `setTimeout`) ends a stuck state and saves what was recorded so far. |
| `unlimitedStorage` | The local Whisper model (~291 MB) is cached in the browser's Cache API after first download so it isn't re-downloaded every session. |
| `activeTab` | Lets the popup read the current tab's URL only when the user opens the popup, so it can offer "Enable on \<host\>" for that specific site. Grants no access to any other tab. |
| `host_permissions` (localhost/127.0.0.1/*.localhost/*.test) | Capture and the on-page indicator run on local dev hosts by default, with no extra prompt, since that's pointcast's core use case (recording your own app while you develop it). |
| `optional_host_permissions` (`*://*/*`: http/https, any host) | Granted per-site, one host at a time, only when the user clicks "Enable on \<host\>" in the popup — for staging servers or preview deployments. Chrome prompts the user before granting; removing it is one click ("Remove \<host\>"). Nothing is requested at install time. |

## Privacy practices tab (data usage disclosure)

- **Does this extension collect or transmit personal data?** No, by default. Audio and DOM data are processed and stored locally on the user's device. The optional CLI feature `--engine openai` (used outside the extension, from the command line) can send audio to an OpenAI-compatible endpoint the user configures — this is not part of the extension's default behavior and requires an explicit flag and API key.
- **Is data sold to third parties?** No.
- **Is data used for purposes unrelated to the extension's core functionality?** No.
- **Is data used to determine creditworthiness or for lending?** No.
