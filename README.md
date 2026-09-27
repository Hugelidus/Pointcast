# pointcast

**Narrate UI changes while you point. Your coding agent gets the exact elements.**

[![CI](https://github.com/Hugelidus/pointcast/actions/workflows/ci.yml/badge.svg)](https://github.com/Hugelidus/pointcast/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Hugelidus/pointcast?include_prereleases&label=beta)](https://github.com/Hugelidus/pointcast/releases)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Public beta (0.1).** Chrome on desktop, developed and tested on Windows; macOS and Linux should work but are untested. Bug reports and feedback: [issues](https://github.com/Hugelidus/pointcast/issues).

## The problem

"Make *this* sortable and move *this* next to *that*" is how we think about UI changes, but a coding agent can't see what "this" is. A screen recording doesn't help much either: the agent needs the DOM element and the source file behind it.

## How it works

1. Press **Record** in the browser extension and talk while you use your app on `localhost`.
2. **Alt+click** or select text on whatever you're talking about.
3. Press **Stop**. pointcast transcribes your voice locally, in the browser, and copies a compact Markdown spec: one request per sentence you said, with the elements you pointed at while saying it:

```markdown
## Request 1

> This [a] should take you to the reports page.

- [a] «View report» → code:
  - used at: `src/pages/Dashboard.tsx` — `<StatCard>`
  - text at: `src/pages/Dashboard.tsx:11` — `<StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" reportHref="/reports/revenue" />`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: a «View report» in «Revenue · Last 30 days» on `/`

## Request 2

> And this [a] button should export the order status.

- [a] «Export» → code:
  - used at: `src/pages/Dashboard.tsx` — `<OrdersTable>`
  - text at: `src/components/OrdersTable.tsx:22` — `<button type="button" id="orders-export" className="btn btn-export"> Export </button>`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: button «Export» in «Orders» on `/`
```

(From a real recording on [examples/react-dashboard](examples/react-dashboard), spoken in Spanish and translated here; selector, DOM path and styles lines trimmed. Two stat cards share the «View report» link: the spec names the Revenue one, on its own line.)

4. Paste it into Claude Code, Cursor or any agent, or let Claude Code fetch it itself with the [plugin](integrations/claude-code-plugin/README.md)'s `/pointcast`.

## Pointing at the code

On a dev build (React 19, Vue 3, Svelte 5), each element leads with the code you pointed at: where that instance is used, which component defines it (marked when it is shared), and the line where its text or data lives, with the source line itself:

```markdown
- [a] «Sales Report» → code:
  - used at: `src/lib/ChartWidget.svelte:27` — `<More title="Sales Report" href="#top" />`
  - defined in: `src/lib/More.svelte` (shared — do not change it unless asked)
  - within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`
  - on screen: a «Sales Report» in «$45,385 · Sales this week» on `/`
```

In a small evaluation this cut the tokens a coding agent spent finding the elements by more than half ([docs/eval](docs/eval/stage0-code-pointer-2026-09-27.md)). The component chain comes from the page. The exact lines need your source, and pointcast reads it where it is:

- **Clipboard** (what Stop does): the spec you paste has the chain and, when the dev server below could be read, the `text at:` lines.
- **Dev server** (nothing to install): at Stop, the extension reads the chain's files from your page's own **Vite** dev server (`/src/…?raw`). It takes at most 2 s, runs while your voice is transcribed, and keeps the source in memory only: the spec gets paths, line numbers and the one source line of each location (your own code, kept local like the rest of the session). Other dev servers (webpack, Next.js) are not supported yet: the spec keeps the chain without `text at:`, and the popup says why in one line.
- **MCP server / Claude Code plugin**: the agent fetches the recording itself, and the lines are resolved in your local repository (`pointcast mcp`, or the [plugin](integrations/claude-code-plugin/README.md)'s `/pointcast`). `pointcast process` does the same from the CLI.

Nothing is added when the text is written more than once: no line beats a wrong line. (Filing the spec as a GitHub issue, `pointcast issue`, is experimental and parked.)

## Why

We tested this instead of assuming it: an evaluation on three real admin dashboards (React, Vue, Svelte) gave a coding agent the same request as plain narration, or as pointcast's spec. Pointing raised accuracy from 78 % to 89 % on identifying the right element, exactly where narration alone is ambiguous — two "Export" buttons, two identical cards, a shared `Button` component. Full numbers, failure cases and limits: [docs/eval](docs/eval/results-2026-09-27.md).

A careful, deliberately written request is still more accurate (96 %) and cheaper in tokens — pointcast doesn't replace precise writing, it replaces having to write precisely while you'd rather just point and talk.

## How it compares

|  | pointcast | [MCP Pointer](https://github.com/etsd-tech/mcp-pointer) | [react-grab](https://github.com/aidenybai/react-grab) | MarkuprPlus |
|---|---|---|---|---|
| Captures | DOM element + narration | DOM element only | DOM element only | screen pixels + narration |
| Narration | yes (local Whisper) | no | no | yes |
| Multiple elements over time | yes, one spec per recording | one at a time | one at a time | tied to a screenshot |
| Source location | React 19, Vue 3, Svelte 5 dev builds: the instance and the line of its text | React fiber (experimental) | React fiber | — |
| Audio leaves your machine | no (local by default) | n/a | n/a | depends on provider |
| Works with | any framework | any | React only | any |

pointcast's angle: DOM-level precision **and** narration **and** many elements per session, so one recording covers a whole list of changes instead of one element at a time.

## Install

**1. The Chrome extension.** Download `pointcast-0.1.0-chrome.zip` from [Releases](https://github.com/Hugelidus/pointcast/releases) and unzip it. In Chrome, open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked* and pick the unzipped folder. (A Chrome Web Store listing comes after the beta. To build it yourself, see [Try it locally](#try-it-locally).)

pointcast runs on `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test` out of the box. For any other site (staging, a preview deployment), open the popup there and press **Enable on `<host>`** — Chrome asks for access to that host only.

> **Turn off Chrome's "Ask where to save each file before downloading"** (`chrome://settings/downloads`). With it on, Chrome asks where to save every file of every recording, and the sessions miss `Downloads/pointcast/`, where the plugin, the MCP server and the CLI look for them. The popup tells you when that happened.

**2. Claude Code (optional).** The plugin lets Claude Code fetch your latest recording itself and apply it with `/pointcast`, resolving each element to its line in your local repository:

```bash
claude plugin marketplace add Hugelidus/pointcast
claude plugin install pointcast@pointcast
```

The MCP server alone, or in Cursor and Windsurf: see the [CLI's README](packages/cli/README.md#mcp-server).

**3. The CLI (optional)**, with Node ≥ 22.12: re-render a session, transcribe it again, or run the MCP server yourself.

```bash
npx pointcast process            # re-render the latest session, with its code lines resolved in the current repo
npx pointcast mcp                # MCP server: list_sessions, get_session, get_element
```

### Known limitations of the beta

- **Chrome only**, desktop. Firefox is not supported yet.
- **The code pointer needs a dev build** of React, Vue 3 or Svelte 5 (the component chain comes from their dev-mode data). Production builds, Angular and other frameworks get the DOM description only: selector, path, HTML, text.
- **Code lines on the clipboard need a Vite dev server.** With webpack or Next.js the pasted spec has the component chain but no `text at:` lines; the plugin, the MCP server and `pointcast process` still resolve them in your local repository.
- **The first recording downloads the Whisper model** (291 MB, once), so it takes longer.

## Privacy

- **Local-first.** Audio and transcription stay on your machine by default (transformers.js/Whisper in the browser). No account, no server, no API key needed.
- **Off by default everywhere but local dev hosts.** Any other site needs an explicit, per-host opt-in; the extension never asks for "all sites".
- **Sensitive fields are never captured**: password fields, `autocomplete=current-password|new-password|one-time-code|cc-*`, or anything marked `data-sensitive`. On a site you've enabled, text that looks like personal data (emails, phone numbers, tokens in URLs) is redacted too.
- **Allowlist, not blocklist.** Only a fixed set of HTML attributes is ever captured; anything unforeseen is excluded by default.
- **A plain click never fires while pointcast is on.** Only Alt+click and text selection are captured; every other click reaches your app exactly as if the extension weren't there.

Full rationale and the canary test that verifies it: [docs/decisions.md](docs/decisions.md#d8-privacy).

## FAQ

**Does this send my voice or my app's data anywhere?** No, by default. Transcription runs in the browser with a local Whisper model (`Xenova/whisper-base`, ~291 MB, downloaded once). An optional `--engine openai` in the CLI can send audio to an OpenAI-compatible endpoint if you explicitly choose to.

**Does it work with my framework?** Element capture works on any page (readable path, selector, HTML, text). The code pointer (which component instance, and the line of its text or data) needs a dev build of React, Vue 3 or Svelte 5; Angular and others are on the roadmap.

**What if I point at the wrong element?** Popup → **Undo last gesture**, or **Alt+Shift+U**. The element flashes grey and the pill confirms what was removed.

**Does Alt+click break my app?** No — the click is cancelled before it reaches the page, so Alt+click on "Delete" never deletes. Every other click passes through untouched.

**How accurate is the transcription?** ~93 % word accuracy on Spanish test recordings, word timing within ~165 ms (median) of ground truth. See [docs/decisions.md § D1](docs/decisions.md#d1-transcription--whisper-via-transformersjs-locally).

**Firefox?** Not yet — the beta targets Chrome MV3. Contributions welcome.

**Is this affiliated with Anthropic, Cursor, or any agent vendor?** No. pointcast is an independent, MIT-licensed, framework-agnostic tool; it happens to be very useful with coding agents.

## Roadmap

- **0.1, public beta** (now) — the extension records your voice and the elements you point at, transcribes in the browser and copies a spec that leads with the code (React, Vue 3, Svelte 5 dev builds); MCP server and Claude Code plugin; CLI.
- **Next** — code lines from more dev servers (webpack, Next.js) and frameworks (Angular); readable GitHub issues from a recording; Chrome Web Store listing; Firefox.

What else is being considered, and why: [docs/ideas.md](docs/ideas.md).

Design decisions and their rationale: [docs/decisions.md](docs/decisions.md).

## Try it locally

The whole loop runs from this repository (Chrome, and Node ≥ 22.12 with pnpm to build it).

1. **Build and load the extension.** Run `pnpm install`, then `pnpm build`. In Chrome, open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked* and pick `packages/extension/.output/chrome-mv3`.
2. **Open an app on a local host.** `pnpm playground` serves test pages on http://localhost:5500. pointcast runs on `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test`, on any port. For any other site (a staging server, a preview deployment), open the popup there and press **Enable on `<host>`**: Chrome asks for access to that host only, and on such sites text that looks like personal data (emails, phone numbers…) is redacted. **Remove `<host>`** turns it off again. The playground is static HTML, so it cannot show [the code pointer](#pointing-at-the-code); `pnpm example:react` and `pnpm example:vue` each start a small Vite dev build of the same "Acme Store" admin dashboard (React 19 and Vue 3, on `127.0.0.1:5174`/`5175`) built to exercise it — shared components, a data-driven sidebar badge, two identically-labeled buttons. Each has a `SCENARIOS.md` under [examples/](examples/) with three narrated pointing scenarios and the code locations they should turn up.
3. **Record.** Click the pointcast icon and press **Record**. The first time, a page asks for the microphone: allow it, then press Record again. The popup says whether the current tab is captured; while recording it should read *Capturing this tab*. Talk while you **Alt+click** things (the app does not react) or select text; only those two gestures are recorded, so a plain click reaches the app exactly as if pointcast were not there. The popup shows the last element it captured. Pointed at the wrong thing? **Undo last gesture** in the popup, or **Alt+Shift+U**, removes it; the element flashes grey and the pill says what was undone. **Alt+Shift+S** starts and stops recording without opening the popup (change it in `chrome://extensions/shortcuts`).
4. **Stop.** Press **Stop** (or Alt+Shift+S). pointcast transcribes your voice on your machine, in the browser, and puts the Markdown in the clipboard. The pill in the page corner turns from *REC* into *Processing… ~0:05* with a progress bar, then says *✓ Copied — paste it into your agent*. The toolbar icon shows *…* and then *✓*, and a notification appears when it is done. The time is an estimate from the length of the recording and the speed measured on your machine in earlier runs. The first time, the Whisper model is downloaded once (291 MB, `Xenova/whisper-base`) and kept in the browser; the popup shows the download in MB. On a desktop CPU, 12 s of speech takes about 5 s, and a minute takes about 17 s.
5. **Paste it into your coding agent.** The popup has **Copy again** and **Show in folder**, and on a dev build one line on whether the code lines were found through your dev server ([Pointing at the code](#pointing-at-the-code)). The session is saved to `Downloads/pointcast/<session-id>/`: `session.md` (the Markdown), `words.json` (the transcript) and `session.json` (the events).

The popup's **Settings**: the spoken **Language** (*Auto-detect* by default; when detection is unsure, pointcast uses the language of your previous session, or its best guess, and says so), **Keep audio** (also saves `audio.wav`), and **Notify when done**. When something goes wrong, the popup says what happened, and the session is still saved with its audio so the CLI can finish it.

**The CLI is optional.** `pnpm pointcast process` re-renders the latest session (or `pnpm pointcast process <session-dir>`) after a change to fusion or rendering, reusing `words.json`. With the audio it can transcribe again (`--force`, `--language es`) or use an OpenAI-compatible endpoint (`--engine openai`), and Node is faster than the browser on slow machines. If Chrome saves downloads somewhere other than your Downloads folder, pass `--dir <that folder>/pointcast` or set `POINTCAST_DIR`.

**The MCP server is optional.** `pnpm pointcast mcp` starts a read-only MCP server (`list_sessions`, `get_session`, `get_element`) so an agent can fetch your latest recording itself instead of you pasting it.

## Development

Requires Node ≥ 22.12 and pnpm.

```bash
pnpm install
pnpm test          # unit tests (fast, offline)
pnpm typecheck     # TypeScript across packages
pnpm playground    # test pages on http://localhost:5500
pnpm example:react # Acme Store dashboard, React 19 + Vite, on http://127.0.0.1:5174 (examples/react-dashboard)
pnpm example:vue   # the same dashboard, Vue 3 + Vite, on http://127.0.0.1:5175 (examples/vue-dashboard)

pnpm dev           # opens Chrome with the extension; reloads it when you edit the code (WXT)
pnpm build         # production build in packages/extension/.output/chrome-mv3
pnpm zip           # packaged extension for loading or distribution: packages/extension/.output/pointcast-<version>-chrome.zip
pnpm e2e           # builds the e2e flavor (.output/chrome-mv3-e2e), then runs it in headless Chromium (Playwright)
```

CLI, from the repository root (paths are relative to where you run it):

```bash
pnpm pointcast transcribe <session-dir | file.wav> [--language es]   # writes words.json
pnpm pointcast process [session-dir] [--language es] [--force]      # writes session.md
pnpm pointcast process [session-dir] --format classic                # transcript + appendix layout
pnpm -s pointcast process <session-dir> --stdout > spec.md          # -s keeps pnpm's banner out of stdout
pnpm pointcast mcp                                                   # MCP server for agents
pnpm pointcast --help                                                # every option
```

`process` reuses `words.json` when it exists, so re-running it after a change to fusion or rendering takes milliseconds; `--force` transcribes again. `--engine openai` sends the audio to an OpenAI-compatible endpoint instead (`POINTCAST_API_BASE`, `POINTCAST_API_KEY`; `OPENAI_API_KEY` is only used for api.openai.com).

`pnpm e2e` never downloads the model, touches the real clipboard or shows notifications: the e2e build records the clipboard and notifications instead, and the harness serves `Xenova/whisper-base` from transformers.js' cache in `node_modules` (filled by the CLI's first transcription, or once with `node scripts/download-model.mjs`).

Slow tests that run the real model: `POINTCAST_SLOW=1 pnpm vitest run packages/cli/src/process/run.slow.test.ts packages/cli/src/transcribe/local.slow.test.ts`. Model benchmark: `cd packages/cli && ./node_modules/.bin/tsx ../../scripts/bench/transcribe.ts` (results in `scripts/bench/results.json`).

## Contributing

Bug reports, feature ideas and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
