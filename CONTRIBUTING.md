# Contributing to pointcast

Thanks for considering it. pointcast is an early public beta (0.2; the original plan is [docs/plan-phase-1.md](docs/plan-phase-1.md)) and design decisions plus their rationale live in [docs/decisions.md](docs/decisions.md) — read the relevant section before changing behavior it documents; if you disagree with a decision, open an issue or PR that edits it with a dated note, rather than quietly working around it.

## Before you start

- **Bug or small fix?** Open a PR directly.
- **New feature or behavior change?** Open an issue first so we can agree on the approach — this project deliberately avoids speculative options and abstractions; the simplest robust version that meets the goal wins.
- **Questions or ideas?** [Discussions](https://github.com/Hugelidus/pointcast/discussions). **Security problems:** privately, see [SECURITY.md](SECURITY.md).

## Setup

Requires Node ≥ 22.12 and pnpm.

```bash
pnpm install
pnpm test          # unit tests (fast, offline)
pnpm typecheck      # TypeScript across packages
pnpm playground     # test pages on http://localhost:5500
pnpm dev            # opens Chrome with the extension; auto-reloads on edit (WXT)
pnpm e2e            # headless Chromium end-to-end suite (Playwright)
```

See the [README's Development section](README.md#development) for the full command list, and [docs/session-format.md](docs/session-format.md) for the on-disk session format.

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
3. **Tag.** Merge the release to `main`, then tag that commit `v<version>` and push the tag (`git tag v0.2.2 && git push origin v0.2.2`). The tagged commit must contain `gemini-extension.json` and `commands/`. The tag starts [`.github/workflows/release.yml`](.github/workflows/release.yml), which stops if the tag differs from `packages/extension/package.json` or `packages/cli/package.json`, or if `npm-shrinkwrap.json` or a version pin is out of date (`shrinkwrap.test.ts`, `plugin.test.ts`, `gemini-extension.test.ts`). It then builds both zips (step 5), packs the CLI (`pointcast-<version>.tgz`), writes `SHA256SUMS.txt` for the release zip and the tarball, and opens a **draft** GitHub release for the tag with those three files and the version's `CHANGELOG.md` section. The store zip is only a workflow artifact of that run, never a release asset. To redo a run, delete the draft first.
4. **Review, then publish the CLI to npm first**, by hand (it needs the owner's 2FA; the workflow has no npm token): check the draft's assets and notes, download `pointcast-<version>.tgz` and `SHA256SUMS.txt` from it, check them (`sha256sum -c SHA256SUMS.txt --ignore-missing`) and `npm publish ./pointcast-<version>.tgz`, so npm gets the very tarball the release lists. npm goes first so the new `pointcast@<version>` pin resolves before the plugins that use it reach users. Then delete the reminder block at the top of the notes and **publish the draft**. Upload the store zip (the run's `pointcast-<version>-chrome-store` artifact) to the stores.
5. **Zips** (built by the workflow; locally with the same commands). `pnpm zip` gives `pointcast-<version>-chrome.zip` for the GitHub release; it carries the manifest `key`, so unpacked installs get the Chrome Web Store item's id. `pnpm --filter @pointcast/extension zip:store` gives `pointcast-<version>-chrome-store.zip`, without the key, for the Chrome Web Store ([chrome-web-store.md](docs/launch/chrome-web-store.md)) and Edge Add-ons ([edge-addons.md](docs/launch/edge-addons.md)). Never upload the release zip to a store.
6. **GitHub release assets.** From 0.2.0 on, every release has **0 or at least 2 assets** (the workflow attaches three: the release zip, the CLI tarball and `SHA256SUMS.txt`; never delete down to one), and no asset name starts with `win32.`, `darwin.` or `linux.`: `gemini extensions install` installs a lone asset as the extension instead of the source, and fails. Gemini installs and updates follow the latest release.
7. **Once:** add the GitHub topic `gemini-cli-extension`, for Gemini CLI's extension gallery. When a store shows an item id that pointcast MCP servers do not accept yet (Edge Add-ons), append it to `OFFICIAL_EXTENSION_IDS` in `packages/core/src/handoff.ts` and release the CLI.

## Commit / PR style

- English, present tense, one logical change per PR.
- Explain the *why* in the PR description, not just the diff — reviewers read `docs/decisions.md`-style reasoning, not just code.
- CI runs `pnpm test` and `pnpm typecheck`; e2e is run for extension-affecting changes.

## Code of conduct

Be respectful and assume good faith. Report unacceptable behavior by opening an issue tagged accordingly, or contacting the maintainer directly via the repository's contact info.

## License

By contributing, you agree your contributions are licensed under the project's [MIT license](LICENSE).
