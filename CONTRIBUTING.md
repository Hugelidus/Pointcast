# Contributing to Pointcast

Thanks for considering it. Pointcast is an early public beta (0.2; the original plan is [docs/plan-phase-1.md](docs/plan-phase-1.md)) and design decisions plus their rationale live in [docs/decisions.md](docs/decisions.md) — read the relevant section before changing behavior it documents; if you disagree with a decision, open an issue or PR that edits it with a dated note, rather than quietly working around it.

## Before you start

- **Bug or small fix?** Open a PR directly.
- **New feature or behavior change?** Open an issue first so we can agree on the approach — this project deliberately avoids speculative options and abstractions; the simplest robust version that meets the goal wins.
- **Questions or ideas?** [Discussions](https://github.com/Hugelidus/pointcast/discussions). **Security problems:** privately, see [SECURITY.md](SECURITY.md).

## Try it locally

The whole loop runs from this repository (Chrome, and Node ≥ 22.12 with pnpm to build it).

1. **Build and load the extension.** Run `pnpm install`, then `pnpm build`. In Chrome, open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked* and pick `packages/extension/.output/chrome-mv3`.
2. **Open an app on a local host.** `pnpm playground` serves test pages on http://localhost:5500. Pointcast runs on `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test`, on any port. For any other site (a staging server, a preview deployment), open the popup there and press **Enable on `<host>`**: Chrome asks for access to that host only, and on such sites text that looks like personal data (emails, phone numbers…) is redacted. **Remove `<host>`** turns it off again. The playground is static HTML, so it cannot show the code pointer; `pnpm example:react` and `pnpm example:vue` each start a small Vite dev build of the same "Acme Store" admin dashboard (React 19 and Vue 3, on `127.0.0.1:5174`/`5175`) built to exercise it — shared components, a data-driven sidebar badge, two identically-labeled buttons. Each has a `SCENARIOS.md` under [examples/](examples/) with three narrated pointing scenarios and the code locations they should turn up.
3. **Record.** Click the Pointcast icon and press **Record**. The first time, a page asks for the microphone: allow it, then press Record again. The popup says whether the current tab is captured; while recording it should read *Capturing this tab*. Talk while you **Alt+click** things (the app does not react) or select text; only those two gestures are recorded, so a plain click reaches the app exactly as if Pointcast were not there. The popup shows the last element it captured. Pointed at the wrong thing? **Undo last gesture** in the popup, or **Alt+Shift+U**, removes it; the element flashes grey and the pill says what was undone. **Alt+Shift+S** starts and stops recording without opening the popup (change it in `chrome://extensions/shortcuts`).
4. **Stop.** Press **Stop** (or Alt+Shift+S). Pointcast transcribes your voice on your machine, in the browser, and puts the Markdown in the clipboard. The pill in the page corner turns from *REC* into *Processing… ~0:05* with a progress bar, then says *✓ Copied · saved to Downloads* (or *✓ Copied · sent to your agent* when a Pointcast MCP server took it). The toolbar icon shows *…* and then *✓*, and a notification appears when it is done. The time is an estimate from the length of the recording and the speed measured on your machine in earlier runs. The first time, the Whisper model is downloaded once (294 MB, `Xenova/whisper-base`) and kept in the browser; the popup shows the download in MB. On a desktop CPU, 12 s of speech takes about 5 s, and a minute takes about 17 s.
5. **Paste it into your coding agent.** The popup has **Copy again** and **Show in folder**, keeps showing the recording's length until the next one, and on a dev build adds one line on whether the code lines were found through your dev server. The session is saved to `Downloads/pointcast/<session-id>/`, or, while a `pointcast` MCP server runs, into that server's sessions folder (the popup says which): `session.md` (the Markdown), `words.json` (the transcript) and `session.json` (the events).

The popup's **Settings**: the spoken **Language** (*Auto-detect* by default; when detection is unsure, Pointcast uses the language of your previous session, or its best guess, and says so), **Keep audio** (also saves `audio.wav`), **Notify when done**, and **Send to a running pointcast MCP server** (on by default; it only acts when one answers). When something goes wrong, the popup says what happened, and the session is still saved with its audio so the CLI can finish it.

**The CLI is optional.** `pnpm pointcast process` re-renders the latest session (or `pnpm pointcast process <session-dir>`) after a change to fusion or rendering, reusing `words.json`. With the audio it can transcribe again (`--force`, `--language es`) or use an OpenAI-compatible endpoint (`--engine openai`), and Node is faster than the browser on slow machines. If Chrome saves downloads somewhere other than your Downloads folder, pass `--dir <that folder>/pointcast` or set `POINTCAST_DIR`.

**The MCP server is optional.** `pnpm pointcast mcp` starts a read-only MCP server (`list_sessions`, `get_session`, `get_element`) so an agent can fetch your latest recording itself instead of you pasting it. While it runs, it also receives recordings from the extension, on `127.0.0.1:20547` only and from the Pointcast extension only, and stores them in its sessions folder.

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
pnpm zip           # packaged extension to load unpacked (GitHub releases): packages/extension/.output/pointcast-<version>-chrome.zip
pnpm --filter @pointcast/extension zip:store  # the store upload, without the manifest key: …/pointcast-<version>-chrome-store.zip
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

The on-disk session format is documented in [docs/session-format.md](docs/session-format.md).

## Making a change

1. **Read `docs/decisions.md`** for the area you're touching (transcription, fusion, capture, privacy, MV3 runtime…). Each decision explains what was rejected and why.
2. **Write the test first** where the code is pure (`packages/core`, `packages/transcribe`): fusion and rendering are TDD'd against synthetic fixtures, no audio or browser needed.
3. **Keep files small and focused**, comments explaining *why* not *what*, no speculative config options nobody asked for.
4. **Run before opening a PR:**
   ```bash
   pnpm test
   pnpm typecheck
   ```
   If you touched the extension's capture, MV3 lifecycle, clipboard/notification behavior or the handoff to the MCP server, also run `pnpm e2e` (headless, no visible windows, no real clipboard/notifications in the e2e build).

   The e2e build hands recordings off to port 5542 (`WXT_HANDOFF_PORT` in `packages/extension/.env.e2e`), never to 20547, so the tests and a real pointcast MCP server on your machine never meet; `e2e/support/paths.ts` refuses to run otherwise. `e2e/handoff.spec.ts` spawns the real CLI from source (`pointcast mcp` with `POINTCAST_HANDOFF_PORT=5542` and a temporary `--dir`) through the MCP SDK's stdio client, and uses a fake receiver for the failure paths. Unit tests bind port 0. No test may bind or contact 20547.
5. **Update `docs/decisions.md`** with a dated note if your change affects a documented decision, and `docs/session-format.md` if you change the session schema (`packages/core/src/schema.ts`).

## Privacy-sensitive changes

Anything touching capture, redaction or what gets written to `session.json` must keep the canary test guarantee (docs/plan-phase-1.md step 8): typing a marker string into a password/token/card field, then clicking and selecting around it, must produce zero occurrences of that string in the saved session. Add or update a test if you change this surface.

## Releasing

The extension, the CLI and the integrations (Claude Code and Codex plugin, Gemini CLI extension) share a minor version.

1. **Versions.** Bump `packages/extension/package.json`, `packages/cli/package.json`, and the three manifests together: `integrations/claude-code-plugin/.claude-plugin/plugin.json`, `integrations/claude-code-plugin/.codex-plugin/plugin.json` and `gemini-extension.json`. With each CLI release, also set the `pointcast@<version>` pin, the CLI's exact version (the Claude plugin directory refuses ranges), in `integrations/claude-code-plugin/.mcp.json` and `gemini-extension.json`: `npx` keeps a cached copy of an unversioned or older spec, and agents only reinstall a plugin whose version changed. `plugin.test.ts` and `gemini-extension.test.ts` fail when these disagree. Update the `pointcast@0.x` snippets in the READMEs too (a minor range is fine there: those are the user's own configs).
2. **Check.** `pnpm test`, `pnpm typecheck`, `pnpm e2e`, and the validators listed in the [plugin's README](integrations/claude-code-plugin/README.md#development).
3. **Publish the CLI to npm first**, so the new `pointcast@<version>` pin resolves before the plugins that use it are pushed.
4. **Zips.** `pnpm zip` gives `pointcast-<version>-chrome.zip` for the GitHub release; it carries the manifest `key`, so unpacked installs get the Chrome Web Store item's id. `pnpm --filter @pointcast/extension zip:store` gives `pointcast-<version>-chrome-store.zip`, without the key, for the Chrome Web Store ([chrome-web-store.md](docs/launch/chrome-web-store.md)) and Edge Add-ons ([edge-addons.md](docs/launch/edge-addons.md)). Never upload the release zip to a store.
5. **GitHub release.** Tag a commit that contains `gemini-extension.json` and `commands/`. From 0.2.0 on, every release has **0 or at least 2 assets** (for example the release zip plus `SHA256SUMS.txt`), and no asset name starts with `win32.`, `darwin.` or `linux.`: `gemini extensions install` installs a lone asset as the extension instead of the source, and fails. Gemini installs and updates follow the latest release.
6. **Once:** add the GitHub topic `gemini-cli-extension`, for Gemini CLI's extension gallery. When a store shows an item id that pointcast MCP servers do not accept yet (Edge Add-ons), append it to `OFFICIAL_EXTENSION_IDS` in `packages/core/src/handoff.ts` and release the CLI.

## Commit / PR style

- English, present tense, one logical change per PR.
- Explain the *why* in the PR description, not just the diff — reviewers read `docs/decisions.md`-style reasoning, not just code.
- CI runs `pnpm test` and `pnpm typecheck`; e2e is run for extension-affecting changes.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report unacceptable behavior privately, as that file explains.

## License

By contributing, you agree your contributions are licensed under the project's [MIT license](LICENSE).
