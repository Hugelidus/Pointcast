# Instruction style: "change only what was pointed at" vs "build what the user means" (2026-09-29)

An end-to-end run on a real app, not a harness: ten UI requests given three ways to the same agent, and the three results reviewed blind.

**Question.** Up to 0.8, every `requests` spec told the agent: "Change only the referenced elements, and only as asked." Is that the right instruction when a request asks for something new (a behaviour, a component, content), not only a tweak to an existing element? And how does a Pointcast recording compare with a carefully written prompt for the same ten requests?

**Short answer.**
- With the old line (**precise**), the agent did the literal minimum on requests for something new. With a line that says the elements are *where*, and that a request for something new should be built well in the app's own style (**intent**), the same recording scored **192 of 200** in a blind review, against **146** with precise and **174** for a careful hand-written prompt.
- Giving the ten requests took the user **1.5 min** with Pointcast (one voice recording) against **~15–20 min** to write the prompt: about **10× less of the user's time**, for comparable or better quality.
- The agent searched about **a third less** with Pointcast (25–26 grep/find/ls calls against 36) and needed a smaller context (184–241 k peak against 315 k).
- Intent costs more than precise (**$6.48 vs $4.24**, 20.8 vs 16.0 min, 75 k vs 46 k output tokens), because it builds more. For closed tweaks (a text, a size, a colour) precise is cheaper and just as good.

So `intent` is now the default, and `precise` stays one setting away ([D5 note 2026-09-29](../decisions.md#d5-html--capture-generously-already-sanitized-render-lean)). Read [Limits](#limits) before quoting: one run per cell.

## Design

- **App.** A private React 19 + Vite study app (~150 source files), at one baseline commit for every run. It has no user data: level 1, 0 XP.
- **Ten requests**, a mix of tweaks and new things: make a section heading bigger; a hover preview on a list row; rotating quotes under a page title; group a weekly agenda by month; a themed progress-bar animation; replace the settings icon with a profile menu; themed level names; per-category highlight switches on a map card; a difficulty/university image on a card; photos for the people named on cards.
- **Agent.** Claude Opus 5.5, medium effort, in every run.
- **Three runs:**
  - **Manual.** One carefully written prompt with all ten requests, written in one go: precise, it describes where each element is, with no code. Interactive session, with a browser tool.
  - **Pointcast, precise.** A 92 s voice recording with one Alt+click per request, then the spec pasted into the agent. The recording was automated, so it can be repeated: a Windows SAPI text-to-speech voice read the requests while Playwright made the gestures, all ten within 12 ms of their word. The spec's preamble had the old instruction line.
  - **Pointcast, intent.** The same recording and spec; only the preamble's instruction line changed.
- Both Pointcast runs were headless (`claude -p`, no browser tool). Both specs ended with the same note: the user is not available to answer questions, so the agent should decide for itself, as a good developer would.
- **Review.** Another Claude session, blind: the three versions were labelled X, Y and Z. It got screenshots of every request in each running version, and the full diffs. Each request was scored 0–5 on four criteria (did it, intent, visual/UX, code): 20 per request, 200 in all.

## Results

| Run | How the requests were given | User's time to give them | Agent time | Tool calls | Search calls (grep/find/ls) | Peak context | Output tokens | Files changed | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Manual | One written prompt with all 10 requests | ~15–20 min | 19.2 min | 142 (44 of them browser checks) | 36 | 315 k | 88 k | 29 (+634/−48) | n/a (interactive) |
| Pointcast, precise | 92 s voice recording, one Alt+click per request | 1.5 min | 16.0 min | 84 | 25 | 184 k | 46 k | 16 (+405/−41, 2 new files) | $4.24 |
| Pointcast, intent | Same recording and spec, new instruction line | 1.5 min | 20.8 min | 121 | 26 | 241 k | 75 k | 18 (+500/−53, 6 new files) | $6.48 |

**Blind review** (max 200):

| Run | Score |
|---|---|
| **Pointcast, intent** | **192** (96 %) |
| Manual | 174 (87 %) |
| Pointcast, precise | 146 (73 %) |

**What made the difference:**
- **Precise did the literal minimum on requests for something new.** The heading was still small, the "profile menu" had two items, and the level names repeated themselves. The line told it to change only what was pointed at, and it did.
- **Intent built each request where the user pointed.** The highlight switches and the difficulty emblem went on the exact card the user clicked, and the new parts used the app's own design tokens, with good accessibility.
- **The manual run was the most ambitious** (a full profile page, photos everywhere), but it put two requests on a different screen from the one the user meant, and had robustness issues: an effect that was invisible at the user's actual state (level 1, 0 XP), hotlinked images, duplicated CSS. A written description of where an element is can point at the wrong place; a gesture does not.

**Search and context.** Both Pointcast runs searched 28–31 % less than the manual one (25 and 26 grep/find/ls calls against 36): the spec's code locations sent the agent to the right files. Their tool calls (84 and 121) compare with the manual run's 98 once its 44 browser checks are left out; the Pointcast runs had no browser. Peak context was 42 % (precise) and 23 % (intent) below the manual run's.

**Against asking one change at a time.** The manual run is the strongest baseline there is: a precise prompt with all ten requests, written at once. Many people instead ask for one change at a time. The [batching evaluation](results-2026-09-28-batching.md) measured that giving six changes one by one costs about **2.5× the input tokens** (190.5 k vs 76.3 k per set) and **2× the agent time** (44 s vs 22 s) of giving them together. If that held here, the gap between Pointcast and one-change-at-a-time prompting would be larger still than the gap measured above. This is an extrapolation from that evaluation (a different model, apps and task), not something this run measured.

## An earlier, less controlled run

This experiment was prompted by an earlier one. The maintainer recorded the same ten requests by voice himself (1 min 40 s, one request missed, some sentences split), with the precise line, and applied the spec in an interactive session. The agent took 10.4 min of working time, 70 tool calls, 17 searches and 187 k peak context, far less than the manual run. The maintainer judged the result clearly below the manual one. That gap is what the intent line was written for: the recording was cheaper, but the instruction held the agent back.

## Limits

- **One run per cell.** Agent runs vary; a second run of each could move the scores by several points. The direction (precise well below, intent at or above manual) is what this supports, not the exact margins.
- **The reviewer is a Claude model**, and may prefer code written by Claude. All three versions were written by the same model, so this biases no run over another in an obvious way, but a human review was not done.
- **The Pointcast runs had no browser tool;** the manual run did (44 of its tool calls). A browser would likely have caught the manual run's wrong screens, and could have made the Pointcast runs better or dearer.
- **The recording is cleaner than a person's.** A text-to-speech voice with gestures timed to the millisecond gives Whisper and fusion an easy job. The earlier human recording (one request missed, split sentences) shows what a real one can look like.
- **The app has no user data** (level 1, 0 XP), which hid one effect of the manual run and may hide others.
- **The manual run's cost is unknown** (an interactive session); its tokens and time are measured.
- **User's time** for the manual prompt is an estimate by the person who wrote it, not a timed measurement.
- **One app, one model, one effort level.** The instruction line may matter less, or more, for a model that already builds generously.
