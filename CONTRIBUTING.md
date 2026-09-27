# Contributing to pointcast

Thanks for considering it. pointcast is an early public beta (0.1; the original plan is [docs/plan-phase-1.md](docs/plan-phase-1.md)) and design decisions plus their rationale live in [docs/decisions.md](docs/decisions.md) — read the relevant section before changing behavior it documents; if you disagree with a decision, open an issue or PR that edits it with a dated note, rather than quietly working around it.

## Before you start

- **Bug or small fix?** Open a PR directly.
- **New feature or behavior change?** Open an issue first so we can agree on the approach — this project deliberately avoids speculative options and abstractions; the simplest robust version that meets the goal wins.
- **Questions or ideas?** Open an [issue](https://github.com/Hugelidus/pointcast/issues).

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
   If you touched the extension's capture, MV3 lifecycle or clipboard/notification behavior, also run `pnpm e2e` (headless, no visible windows, no real clipboard/notifications in the e2e build).
5. **Update `docs/decisions.md`** with a dated note if your change affects a documented decision, and `docs/session-format.md` if you change the session schema (`packages/core/src/schema.ts`).

## Privacy-sensitive changes

Anything touching capture, redaction or what gets written to `session.json` must keep the canary test guarantee (docs/plan-phase-1.md step 8): typing a marker string into a password/token/card field, then clicking and selecting around it, must produce zero occurrences of that string in the saved session. Add or update a test if you change this surface.

## Commit / PR style

- English, present tense, one logical change per PR.
- Explain the *why* in the PR description, not just the diff — reviewers read `docs/decisions.md`-style reasoning, not just code.
- CI runs `pnpm test` and `pnpm typecheck`; e2e is run for extension-affecting changes.

## Code of conduct

Be respectful and assume good faith. Report unacceptable behavior by opening an issue tagged accordingly, or contacting the maintainer directly via the repository's contact info.

## License

By contributing, you agree your contributions are licensed under the project's [MIT license](LICENSE).
