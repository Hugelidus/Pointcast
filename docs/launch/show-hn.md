# Show HN

## Title (max 80 chars)

```
Show HN: pointcast – Alt+click while you talk, get a spec your AI agent can use
```

Alternates:
```
Show HN: pointcast – narrate UI changes while pointing, transcribed locally
Show HN: I built a Chrome extension that turns "make this sortable" into a coding-agent spec
```

## Text

I kept typing "make this sortable and move this next to that" into Claude Code / Cursor and then re-typing which element I meant, because the agent can't see what "this" is. A screen recording doesn't really help either — the agent still needs the actual DOM element and the source file behind it.

pointcast is a Chrome extension: press Record, talk about your app the way you normally would ("this should be sortable by quantity"), and Alt+click or select whatever you're referring to as you say it. Press Stop and it transcribes your voice locally in the browser (Whisper via transformers.js, no audio leaves your machine by default), fuses the words with the elements you pointed at, and copies a Markdown spec — one request per sentence, with the selector, readable DOM path, and source location (`file:line`) when your dev build exposes it.

I ran an evaluation before writing this post rather than just assuming it works: on three real open-source admin dashboards (React, Vue, Svelte), giving a coding agent the same spoken request with vs. without the pointing gestures raised element-identification accuracy from 78% to 89% — precisely on the ambiguous cases (two "Export" buttons, two identical cards, a shared `Button` component). A careful hand-written description is still more accurate (96%) and cheaper in tokens, which is expected — pointcast isn't trying to beat precise writing, it's trying to remove the need to write precisely while you'd rather just point and talk. Full numbers and failure cases: [docs/eval](../eval/results-2026-09-27.md) (methodology, per-app breakdown, what went wrong).

Some things I think are worth mentioning:
- Runs entirely on `localhost` by default; other sites need an explicit, one-host-at-a-time opt-in.
- Alt+click is cancelled before it reaches the page (same convention as MCP Pointer), so pointing at "Delete" never deletes.
- Password fields, tokens, and (on enabled remote sites) text that looks like personal data are redacted at capture time, verified by a canary test.
- MIT licensed, TypeScript monorepo, design rationale for every non-obvious decision is written down in [docs/decisions.md](../decisions.md).

It's Phase 1 (see [docs/plan-phase-1.md](../plan-phase-1.md)) — Chrome only for now, source-location support is limited to what dev builds already expose. Feedback, especially on where the pointing/fusion breaks down, very welcome.

GitHub: <link>
