# Evaluation harness

Does a coding agent find the right elements more reliably, faster or with fewer tokens when it gets a pointcast session instead of text? The [pilot](../../docs/eval/archive/pilot-2026-09-27.md) asked this on the one-page playground. This harness asks it on three real apps built with different stacks, where finding an element means searching many files.

## Apps

Three open-source admin dashboards, each with several pages and many components, running on a Vite dev server with mock data (no backend, no login):

| App | Stack | Commit | License | Port |
|---|---|---|---|---|
| [shadcn-admin](https://github.com/satnaing/shadcn-admin) | React 19 + Vite + TanStack Router + shadcn/ui | `e16c87f` | MIT | 5542 |
| [vuestic-admin](https://github.com/epicmaxco/vuestic-admin) | Vue 3 + Vite + Vuestic UI | `9c5b44f` | MIT | 5543 |
| [flowbite-svelte-admin-dashboard](https://github.com/themesberg/flowbite-svelte-admin-dashboard) | SvelteKit 2 (Svelte 5) + Vite + Flowbite Svelte | `171b17e` | MIT | 5544 |

Why these:

- **They look like real products.** Sidebars, navbars, cards, charts, tables and tabs, split into one component per file, as in a real codebase.
- **They have the ambiguity pointing is meant to remove.** Two "Export" buttons (vuestic), two identical "Users" cards (flowbite), a "Download" button styled by the shared `Button` component (shadcn), a "Sales Report" link rendered by a shared `More` component (flowbite).
- **They run with one command and no services**, so every run is reproducible from the pinned commit.
- **Permissive licenses** (MIT), popular enough to be recognizable, small enough to install in ~20 s each.

`dev/eval/apps.json` pins each commit. vuestic-admin uses yarn 4; the setup converts its `yarn.lock` with `pnpm import` and installs with a flat `node_modules` (`--shamefully-hoist`), because it imports `@floating-ui/dom` without declaring it, which works only with yarn's flat layout.

## Scenarios

`dev/eval/scenarios/<app>/` holds, per app:

- `scenario.json`
  - `narration`: what a user says in Spanish while pointing, with pauses. Five changes each, mostly with deictics ("este botón", "esta tarjeta", "este gráfico", "este número") and one without ("el texto de ventas recientes…", "donde pone total earnings…").
  - `gestures`: which element to Alt+click (`point`) or drag-select (`select`), at the start of which spoken word (`word` + `occurrence`), as a Playwright selector.
  - `changes`: the ground truth, one entry per requested change, with the regular expressions the grader uses (below).
- `M2.md`: the careful written request a diligent user would type, naming visible labels. Written from the screen only, without reading the source.
- `narration.wav` + `narration.words.json`: the narration synthesized by `dev/scripts/tts/generate.ps1 -ScriptJson <scenario.json>` (Windows SAPI, voice Microsoft Helena, straight to a file) and the exact start time of every word. They are committed so the recording does not depend on the voices installed.

`dev/eval/scenarios/pilot/` is the pilot's ground truth for the playground. Its session is the user's own recording, so it is not in git.

## Conditions

The same task prompt (`dev/eval/prompt.md`) with a different request inside:

| Condition | Request |
|---|---|
| **P-classic** | pointcast's classic `session.md` |
| **P-requests** | pointcast's `requests` format |
| **M1** | the session's transcript: the same words, without the pointing |
| **M2** | `M2.md`, the careful written description |

P-classic and P-requests are rendered by the CLI (`pointcast process <session> --format … --stdout --no-copy`) from the same recorded `session.json` + `words.json`. M1 is the transcript those two were built from, so M1 differs from P only by the pointing.

## Steps

```sh
node dev/eval/setup-apps.mjs                 # clone at the pinned commits, install, headless check
powershell -File dev/scripts/tts/generate.ps1 -ScriptJson dev/eval/scenarios/<app>/scenario.json   # only if the narration changes
node dev/eval/record.mjs <app>               # needs the e2e build of the extension (pnpm e2e builds it)
node dev/eval/run.mjs                        # 3 apps × 4 conditions × 3 repeats, 4 at a time
node dev/eval/grade.mjs dev/eval/.runs/<run>     # grades.json + summary.md
node --test dev/eval/grade.test.mjs          # the grader's own tests
```

- **setup-apps.mjs** starts each dev server, loads the start page in headless Chromium, and checks that every gesture's word is in the narration and its element is visible. Screenshots go to `dev/eval/.runs/setup/`.
- **record.mjs** is `dev/e2e/capture.spec.ts` as a script. Headless Chromium, muted, loads the extension, and uses the scenario's `narration.wav` as the microphone. It presses Record, performs each gesture exactly when its word starts, presses Stop once the narration has played through, and waits for the transcription. It then copies the session to `dev/eval/.runs/sessions/<app>/`, with `clipboard.md` (what the extension copied) and `gestures.json` (planned vs actual times). It uses the **e2e build** (`chrome-mv3-e2e`) on purpose: that build records clipboard writes and notifications instead of performing them, and loads Whisper from a local server (port 5541, as `pnpm e2e` does) instead of downloading 291 MB into every fresh profile. Everything else is the same extension. Downloads go to a temporary folder, checked before recording. Do not run it at the same time as `pnpm e2e` (both use port 5541).
- **run.mjs** runs `claude -p --output-format json --model sonnet --effort medium --json-schema <answer schema>` in the app's folder, with the prompt on stdin. Isolation, as far as the CLI allows:
  - `--tools Read,Grep,Glob` (no other tool exists in the session) and `--permission-mode dontAsk`.
  - `--setting-sources ""` (no user, project or local settings, so no plugins, hooks or permissions of the user's).
  - `--safe-mode` (no CLAUDE.md, skills, plugins, hooks or MCP) and `--strict-mcp-config` (no MCP servers).
  - `--no-session-persistence` (nothing written to `~/.claude`).
  - Environment variables of an enclosing Claude Code session are dropped.
  - `--bare` would isolate more, but it accepts only `ANTHROPIC_API_KEY`, not a subscription login.

  Results go to `dev/eval/.runs/<run>/<app>/<condition>/r<k>.json`. Re-running with the same `--out` only does what is missing.

## Grading

Deterministic, from the regular expressions of each change in `scenario.json` (all matched case- and accent-insensitively):

- `topic` finds the answer items that address the change (on the item's `request`).
- `files` lists where the edit may go.
- `target` is what the item's `target` must mention to be the right element; `lines` optionally accepts an item by line number instead, for elements that only their position tells apart.
- `wrong` names a wrong or shared construct (the shared `.primary` class, the other Export button, the shared `More` component), matched on the file and on the construct itself, ignoring the agent's comments after it.

A change is **correct** when at least one item addresses it and every item that addresses it is right. Hedging between the right element and a wrong one, or editing a shared style that also changes elements the user did not point at, counts as **wrong**. No item at all counts as **missed**. `grades.json` keeps every item and every decision, so a person can audit them. `summary.md` has one row per app × condition: accuracy, input tokens (uncached, cache write, cache read, as the CLI reports them), output tokens, cost, turns and duration.

## Dry run (2026-09-27, pilot only, 1 run per condition)

This run checked the runner's flags and the grader's parsing, not the results: 4 runs, $0.45, 67 s in parallel. The agent in every run had only Glob, Grep and Read, returned `structured_output`, and had no permission denials.

| Condition | Correct | Input total | Output | Cost (USD) | Turns | Time (s) |
|---|---|---|---|---|---|---|
| M1 | 2/5 | 36.3 k | 3.3 k | 0.103 | 7 | 35 |
| M2 | 5/5 | 76.3 k | 2.7 k | 0.104 | 9 | 34 |
| P-classic | 4/5 | 42.3 k | 3.3 k | 0.109 | 5 | 42 |
| P-requests | 4/5 | 62.4 k | 5.5 k | 0.132 | 9 | 64 |

Both P runs lost the same change: they recolored `button.primary`, the class the Export button shares with Save, next to `#export-btn`. The spec lists `class primary` among Export's search hints. The pilot's sub-agents did not do this; `claude -p` did.

## Typed evaluation (2026-09-28): `dev/eval/typed/`

One UI change per task, recorded with the extension in typed mode, three variants: **A** a hand-typed request written by an independent writer from a screenshot, **B** the Pointcast spec without code lines, **C** the recording read through the pointcast MCP server (`--mcp-config` per run), which resolves code locations in the app. Results: [docs/eval/archive/results-2026-09-28.md](../../docs/eval/archive/results-2026-09-28.md).

- `tasks.json`: the four apps (the three above plus mdn/django-locallibrary-tutorial, run from a clone outside the repo with the settings in `django/`), 16 tasks with gesture, note, the A writer's intent and the ground truth (the `grade.mjs` rules).
- `record.mjs` (typed recordings, handoff off), `prepare.mjs` (B specs, C's MCP configs, prompt hashes), `write-a.mjs` (A requests; the screenshot goes inside the message), `run.mjs` (the runs, stream-json), `grade.mjs` (accuracy, tokens, tool calls, searches before the first ground-truth read), `claude.mjs` (the `claude -p` runner with a cost ledger and a stop-loss).
- `batching.json` + `batching.mjs` (subcommands record, prepare, write-a, run, grade): the batching follow-up, sets of 6 changes per app delivered 1-by-1, 2-by-2 and all-6 in variants A and C, one typed recording per run ([results](../../docs/eval/archive/results-2026-09-28-batching.md)).
- Differences from the runs above: no `--safe-mode` (it disables MCP), auto memory off through `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` instead.
- Windows: inside a worktree the path to shadcn-admin's pnpm store gets too long for Node (`ERR_PACKAGE_IMPORT_NOT_DEFINED` from vitest when Vite loads its config). Install it with `pnpm install --frozen-lockfile --ignore-workspace --config.virtual-store-dir-max-length=40`.

## Full run (2026-09-27)

36 runs, $3.42: [docs/eval/archive/results-2026-09-27.md](../../docs/eval/archive/results-2026-09-27.md). After a manual audit of every answer, two ground-truth regular expressions were tightened (shadcn's subtitle, flowbite's Sales Report link); the results page says which and why. Its addendum re-runs P-requests on shadcn-admin and flowbite-svelte-admin after fixing two of the failures it found (6 runs, $0.63).
