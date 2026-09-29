# Evaluations

Does a coding agent do better with a Pointcast recording than with text? These pages measure it, one question at a time, and each one says what it did not measure.

**How they are run.** Most evaluations use the harness in [`dev/eval`](../../dev/eval/README.md): open-source apps pinned to a commit (shadcn-admin with React, vuestic-admin with Vue, flowbite-svelte-admin with Svelte, and the MDN Django tutorial app), recordings made headlessly with the real extension build, and the agent under test run with `claude -p` on the same task prompt in every condition. Answers are graded by a deterministic script against a ground truth written before any run; hedging between the right element and a wrong one counts as wrong. The instruction-style evaluation is different: an end-to-end run on a private app, where the agent implemented the changes and another Claude session reviewed the three results blind. Every page lists its limits; read them before quoting a number.

## Current results

These still describe the shipped version, 0.8.1.

**[Instruction style: "change only what was pointed at" vs "build what the user means"](results-2026-09-29-instruction-style.md)** (2026-09-29, measured on the build that became 0.8.1). Ten UI changes on a real React app took the user 1.5 min as one Pointcast voice recording, against ~15–20 min to write them as one careful prompt. In a blind review (max 200), the recording with the new default instruction (*intent*) scored 192, the hand-written prompt 174, and the same recording with the old instruction (*precise*) 146. *Caveat:* one run each, and the blind reviewer is an AI model (Claude), not a person.

**[Next.js App Router: what the code pointer says](nextjs-2026-09-28.md)** (2026-09-28, the change released in 0.7.0). On a 13-element Next.js 16 example app, every component chain matches the ground truth, Server Components included (0.6.0 had 6 wrong and 7 missing), and 10 of 11 `text at:`/`data at:` lines through the CLI or MCP server are exact, with no wrong location. *Caveat:* one small app written for the check, one Next.js version, and no agent was run: it checks what the spec says, not what an agent does with it.

A re-run of the [batching evaluation](archive/results-2026-09-28-batching.md) on 0.8.1 is planned.

## History

All evaluations, newest first. Superseded ones are kept in [`archive/`](archive/), unchanged apart from a note at the top and fixed links.

| Date | Version measured | Question | Headline | Superseded by |
|---|---|---|---|---|
| 2026-09-29 | build that became 0.8.1 | [Instruction style](results-2026-09-29-instruction-style.md): should the spec tell the agent to change only what was pointed at, or to build what the user means? And how does a recording compare with a careful written prompt? | Blind review: intent 192/200, hand-written prompt 174, precise 146; 1.5 min by voice vs ~15–20 min to write. One run each. | Still valid |
| 2026-09-28 | 0.6.0 vs the change released in 0.7.0 | [Next.js App Router](nextjs-2026-09-28.md): what does the code pointer say on Next.js, and is it right? | Chains 13/13 right (0.6.0: 0/13); text/data lines 10/11 exact, 0 wrong. No agent run. | Still valid |
| 2026-09-28 | 0.4 | [Batching](archive/results-2026-09-28-batching.md): one request with six changes vs one or two at a time, hand-typed and through the MCP server | Six changes in one recording: 96 % vs 85 % for a hand-typed request with the same six, 24 % fewer input tokens, 75 % fewer searches; one by one, no saving. | Older version (0.4); a re-run on 0.8.1 is planned |
| 2026-09-28 | 0.4 | [Typed mode, code pointer and MCP server](archive/results-2026-09-28.md) on four apps (React, Vue, Svelte, Django), one change per request | Through the MCP server 96 % right vs 84 % for a quick hand-typed request, 60 % fewer searches, but no saving in tokens, time or cost for one change. | Batching (same day), for the token question |
| 2026-09-27 | pre-0.1.0 build, prototype code pointers | [Stage 0: code pointer](archive/stage0-code-pointer-2026-09-27.md): does adding `file:line` for each element save the agent work? | Chain plus repo lookup: 44/45 right with 39.9 k input tokens vs 43/45 and 93.7 k for the spec without it (−57 %). Built as the code pointer. | Typed-mode evaluation (the shipped code pointer, 0.4) |
| 2026-09-27 | pre-0.1.0 build | [Three real apps](archive/results-2026-09-27.md): pointing vs the same words vs a careful written request; `classic` vs `requests` format | Pointing 89 % vs 78 % for the same words; a careful written request 96 % and cheaper. `requests` became the default format. | Stage 0 and the typed-mode evaluation |
| 2026-09-27 | pre-0.1.0 build | [Pilot](archive/pilot-2026-09-27.md) on the one-page playground | 5/5 changes right with pointing in 3 of 3 runs vs 53 % for the same words; no token saving on a one-file app. | Three real apps |
