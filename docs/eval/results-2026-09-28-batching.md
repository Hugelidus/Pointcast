# Batching: one recording with six changes vs one or two at a time (2026-09-28)

A follow-up to [the typed-mode evaluation of the same day](results-2026-09-28.md), in the same harness, apps, agent settings and grading.

**Question.** Does it save anything to put several changes in ONE request instead of asking one by one or two by two? That holds both for a hand-typed request (**A**) and for a Pointcast recording read through the MCP server (**C**). And how do tokens per change scale from 1 to 2 to 6 changes per run?

**Short answer.** Yes: batching is where the savings are, for both variants, and more for Pointcast. Delivering a set of 6 changes in one run instead of six costs **C 73 % fewer input tokens** (58 k instead of 219 k per set), 63 % less money ($0.051 instead of $0.136) and 58 % less agent time (20 s instead of 48 s), with the same accuracy (69/72 against 70/72). For A the same move saves 60 % of input tokens (76 k instead of 191 k), but A's accuracy does not improve: fewer hedges, but the writer's multi-change texts sent the agent to the wrong element more often (5 of 16 texts misplaced an element). With six changes per run, C beats A on every measure: accuracy **96 % vs 85 %**, input **58 k vs 76 k tokens per set (−24 %)**, cost **$0.051 vs $0.070 (−27 %)**, and Grep/Glob **1.9 vs 7.5 per set (−75 %)**. One by one, C costs about the same as A (219 k vs 191 k tokens), as the first evaluation found.

Read [Limits](#limits-and-threats-to-validity) before quoting.

## Design

- **Sets.** Per app, 6 changes: the 4 tasks of the first evaluation plus 2 new ones (`dev/eval/typed/batching.json`), whose ground truth was written before any run:

  | App | New task | Kind | Right place; wrong places |
  |---|---|---|---|
  | shadcn | revenue-change: «+20.1% from last month» of Total Revenue → «+20,1 % vs. mes anterior», only there | repeated | `index.tsx:81`; not `:108`/`:132` |
  | shadcn | analytics-tab: tab «Analytics» → «Analítica» | plain | `index.tsx:49`; not `analytics.tsx` |
  | vuestic | view-all: «View all projects» → «Ver todos» | plain | `ProjectTable.vue:28` |
  | vuestic | monthly-title: card title «Monthly Earnings» → «Ingresos mensuales» | repeated | `MonthlyEarnings.vue:4`; not the chart label in `lineChartData.ts:20` |
  | flowbite | remove-users: the duplicate «Users» card | repeated | `Dashboard.svelte:133–152`; not the first card (`:127`), not `ProductMetricCard.svelte` |
  | flowbite | desktop-title: device label «Desktop» → «Ordenador» | data, repeated, shared | `Dashboard.svelte:84`; not `Traffic.svelte`'s default subtitle «Desktop» (also on screen), `SmallPanel.svelte`, `TrafficEx.svelte` |
  | locallibrary | copies-heading: `<h4>Copies</h4>` → «Ejemplares» | repeated | `book_detail.html:14`; not `index.html`'s «Copies:» |
  | locallibrary | summary-label: «Summary:» → «Resumen:» | plain | `book_detail.html:8` |

- **Granularities.** Each set is delivered as **1-by-1** (6 runs), **2-by-2** (3 runs: changes 1+2, 3+4, 5+6, in the order of `batching.json`) and **all-6** (1 run).
- **A.** One request per run, written by the same kind of independent writer as before (Sonnet, no tools, isolated). The writer got the screenshots of that run's elements (each with its element outlined, taken from the one-change recordings) and one sentence of intent per screenshot. It was told to type all changes as ONE message, in Spanish, in at most 40 / 65 / 150 words for 1 / 2 / 6 changes. All 24 texts came in under the limit on the first try.
- **C.** For each run, ONE typed recording made with the extension (e2e build, headless, handoff off). It holds exactly that run's changes: Record, then per change the gesture and its note, navigating when the next element is on another page (locallibrary: book page → home → book page), then Stop. All 24 new recordings captured exactly the planned events on the intended elements. The agent read the recording through the MCP server, with the same `--mcp-config` setup and request text as before.
- **B** was not run: the budget left after A and C (3 repeats) did not cover it with a margin under the stop-loss.
- **Runs.** 3 repeats per cell. The 1-by-1 cells of the 16 tasks from the first evaluation reuse that evaluation's runs r1–r3: same prompts, recordings and settings, run the same day. Only the 8 new tasks got new one-change runs. New runs: 24 units × 2 variants × 3 repeats = 144, all with a structured answer. Same agent settings as the first evaluation (Sonnet, medium effort, Read/Grep/Glob, no `--safe-mode`, auto memory off by environment variable, stream-json), with `--max-budget-usd 1.5` per run (no run came near it).
- **Grading.** `dev/eval/grade.mjs`'s rules, unchanged.
  - A run with several changes assigns answer items to changes by a per-change `topic` regular expression on the item's `request` (`batching.json`), as the original grader does. A one-change run grades every item against its change.
  - **Strict:** a change is correct when every item addressing it is right; hedging is wrong.
  - **First choice:** the change's most confident item is right.
  - **Missed:** no item addresses it. There were no missed changes.
  - Per **set**: the sum over the runs needed to deliver all 6 changes (6, 3 or 1 runs). Time is the sum of the CLI's `duration_ms`, as if the runs were made one after another.

## Results

Means per set (4 apps × 3 repeats = 12 sets per cell; 72 changes):

| Variant | Changes per run | Correct (strict) | First choice correct | Input tokens per set | Input per change | Output per set | Cost per set (USD) | Agent time per set (s) | Grep+Glob per set | Tool calls per set |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | 61/72 (85 %) | 70/72 | 190.5 k | 31.7 k | 3.6 k | 0.137 | 44 | 10.4 | 22.5 |
| A | 2 | 60/72 (83 %) | 65/72 | 106.2 k | 17.7 k | 2.7 k | 0.087 | 28 | 8.6 | 15.3 |
| A | 6 | 61/72 (85 %) | 63/72 | 76.3 k | 12.7 k | 2.3 k | 0.070 | 22 | 7.5 | 12.2 |
| C | 1 | 70/72 (97 %) | 72/72 | 219.4 k | 36.6 k | 3.4 k | 0.136 | 48 | 3.6 | 21.6 |
| C | 2 | 70/72 (97 %) | 72/72 | 109.6 k | 18.3 k | 2.2 k | 0.076 | 24 | 3.0 | 11.9 |
| **C** | **6** | **69/72 (96 %)** | 69/72 | **58.2 k** | **9.7 k** | **1.7 k** | **0.051** | **20** | **1.9** | **5.7** |

**How tokens per change scale.**
- **Median input per change within a run:** A 27.8 k → 14.8 k → 10.7 k; C 30.5 k → 15.8 k → 7.9 k, for 1 → 2 → 6 changes per run. Each run carries a fixed cost of ~18–28 k tokens of context, plus C's one `get_session` round trip. Batching shares that cost across changes.
- **The extra cost of a change inside a batch is small for C:** from 2 to 6 changes per run, the set costs 51 k fewer tokens for C, against 30 k fewer for A. A's batched runs keep searching (7.5 Grep/Glob per set at 6 per run); C's resolved pointers let most changes go without a search (1.9 per set).
- **1-by-1, C is the dearer variant** (+15 % input tokens, about the same cost), as in the first evaluation. The break-even is at about 2 changes per run (109.6 k vs 106.2 k). At 6 per run, C is 24 % below A in tokens and 27 % in cost.

Per app (correct of 6 per repeat · input tokens per set · Grep+Glob per set):

| App | Variant | 1-by-1 | 2-by-2 | all-6 |
|---|---|---|---|---|
| shadcn-admin | A | 6, 6, 6 · 168–178 k · 7–8 | 6, 6, 6 · 86–106 k · 8–11 | 6, 6, 6 · 49–52 k · 7–8 |
| shadcn-admin | C | 5, 5, 6 · 210–239 k · 4–6 | 5, 5, 6 · 120–131 k · 5–8 | 6, 5, 6 · 80–90 k · 2–5 |
| vuestic-admin | A | 6, 6, 6 · 159–187 k · 10–11 | 6, 6, 5 · 78–130 k · 8–12 | 4, 3, 3 · 75–193 k · 8–15 |
| vuestic-admin | C | 6, 6, 6 · 249–275 k · 6–8 | 6, 6, 6 · 97–148 k · 2–6 | 5, 6, 5 · 21–161 k · 0–9 |
| flowbite-svelte-admin | A | 3, 2, 2 · 214–286 k · 12–22 | 3, 4, 3 · 124–166 k · 8–9 | 5, 5, 5 · 64–77 k · 6–7 |
| flowbite-svelte-admin | C | 6, 6, 6 · 187–241 k · 1–2 | 6, 6, 6 · 88–127 k · 0–2 | 6, 6, 6 · 36–55 k · 0 |
| locallibrary | A | 6, 6, 6 · 157–165 k · 6–7 | 5, 5, 5 · 65–114 k · 5–7 | 6, 6, 6 · 30–45 k · 3–5 |
| locallibrary | C | 6, 6, 6 · 161–193 k · 1 | 6, 6, 6 · 82–83 k · 1 | 6, 6, 6 · 34–48 k · 1 |

Per-change results and every failure: `dev/eval/.runs/batching-2026-09-28/summary.md` and `grades.json` (not in git).

## Failures

**C (7 wrong of 216 graded changes).**
- *refund-amount (shadcn), 4 wrong (2 at 1-by-1, 2 at 2-by-2).* The same hedge as in the first evaluation: two rows show +$39.00, and the resolver is silent. All 4 had the right first choice. At all-6 it was 3/3.
- *menu-projects (vuestic, i18n), 2 wrong at all-6.* Both answered the sidebar component `AppSidebar.vue` (`<VaSidebarItemTitle>`), which the spec's `used at:` names, instead of the locale file. There is no pointer for an i18n label. In a six-change run, the agent took the spec's line instead of searching as it did one by one (3/3 there).
- *users-nav (shadcn), 1 wrong at all-6.* It answered the shared `nav-group.tsx` (`{item.title}`), the chain's first frame, instead of `sidebar-data.ts`. This is the "edited the shared component" error Stage 0 was built to prevent; here the chain had no `data at:` (the Radix wrappers used up the 3-frame cap, see the first evaluation).
- Pattern: C's three all-6 errors were **not** hedges (first choice wrong). With six changes in one run, the agent searches less for each, and it trusts `used at:` where the spec has no text location.

**A (34 wrong of 216).**
- **Hedges into lookalikes, one by one:** the flowbite demo copies (`StatsEx.svelte`, `TrafficEx.svelte`) and the two «Sales Report» links, as in the first evaluation. These fade with batching: flowbite A went from 7/18 to 15/18. With six changes in one message, the agent answered each change once and hedged less. Its first choices were as right as before.
- **The writer described the wrong element when writing several changes at once.** 5 of the 16 multi-change texts misplaced at least one element:
  - vuestic all-6: «Export» "del panel de Revenue Report" (it is Revenue by Top Regions), and «Expenses this month» "en el panel Yearly Breakup";
  - flowbite 2-by-2 and all-6: the link to rename called «Full report» (it is «Sales Report»);
  - flowbite 2-by-2: «Desktop» placed "en el gráfico de Sales by category";
  - locallibrary 2-by-2: «Imprint:» placed "en la página de detalle de la copia individual".

  The agent then edited the element the text described: 0/3 on each of those changes. The one-change texts had one such mistake in 24 (the «Sales Report» link, first evaluation). This is part of why A does not get more accurate with batching while C does not get less. Describing six elements from memory is where hand-typed requests go wrong, and where pointing does not.

## Limits and threats to validity

- **Small:** 4 sets of 6 changes, 3 repeats, one model and effort. Per-set numbers have a wide spread (vuestic C all-6: 21 k to 161 k tokens). A 1–2 change difference out of 72 is noise.
- **The A writer is an LLM** looking at 2 or 6 screenshots at once, and its mistakes decide much of A's accuracy at 2 and 6 changes. A person who knows the app may describe better, or worse. A's accuracy at 2 and 6 changes should be read as "what a quick description of several screens risks", not as a measured human error rate. A's *token* numbers do not depend on this much.
- **The 1-by-1 cells of 16 tasks are reused** from the first evaluation (same prompts, recordings and settings, same day), not re-run next to the batches. There was no same-session control for them.
- **The pairs are fixed** (1+2, 3+4, 5+6, in the order of `batching.json`); other pairings or orders were not tried. The notes are the ones of the one-change recordings, typed in the same order.
- **Topic assignment.** In multi-change runs, items are assigned to changes by regular expressions on the agent's own summary of each change. Every failure above was read by hand, and none came from a wrong assignment. No change was "missed".
- **The new tasks and their ground truth were written by the evaluator after reading the source,** like the first 16.
- **Time is the agent's time only** (the sum of `duration_ms`). It excludes the person's time to record or type, which batching also saves, and which this evaluation did not measure.
- **B was not run**, so this does not say how much of C's batched advantage comes from the code lines and how much from the DOM description. The first evaluation found B about as accurate as C with more searches.
- **Identification only:** no edit was applied.

## Cost

$5.02 for this follow-up (`ledger.jsonl`, 168 calls):
- 144 agent runs: $4.43 (A $2.40, C $2.03);
- 24 writer calls: $0.59.

With the first evaluation's $6.30, the total is $11.32 of the $15 approved. The follow-up's stop-loss (no new run after $7.50, hard limit $8) was not reached.

## Reproduce

```sh
node dev/eval/typed/batching.mjs record  --out <dir> --first <first eval dir> --django-dir <clone> --python <venv python> --django-pythonpath dev/eval/typed/django
node dev/eval/typed/batching.mjs prepare --out <dir> --first <first eval dir> --django-dir <clone>
node dev/eval/typed/batching.mjs write-a --out <dir> --first <first eval dir>
node dev/eval/typed/batching.mjs run     --out <dir> --first <first eval dir> --django-dir <clone> --repeat 1   # 2, 3
node dev/eval/typed/batching.mjs grade   --out <dir> --first <first eval dir>
```
