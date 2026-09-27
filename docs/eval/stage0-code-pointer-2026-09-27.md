# Stage 0: does a code pointer save the agent work? (2026-09-27)

**Question.** If the spec adds a *code pointer* for each pointed element (the chain of app components that rendered that instance, as `file:line`), does a coding agent find the same elements with fewer tokens and searches? The feature is built only if a bar set before the runs is met.

**Short answer.** Yes, in one of the three variants tested. **P-chain-repo** (the chain plus a `text at: file:line` line from a small repo lookup) got 44/45 with 39.9 k input tokens per run, against 43/45 and 93.7 k for today's `requests` spec (−57 %) and 35/45 and 90.5 k for a realistic typed request (M3). It meets every part of the bar. The chain alone, with or without line numbers, was just as cheap but failed the bar on shadcn-admin: in 2 of 6 runs the agent removed the sidebar badge in the shared `NavBadge` component, the second frame of the chain. That is a new "edited the shared component" error. The repo lookup's line into the sidebar data file prevented it.

**Recommendation: build it, as P-chain-repo, in dev mode only**, with the conditions listed under [Recommendation](#recommendation). The evidence is 3 runs per app on 15 changes, and the chain rules were fixed by someone who knew the ground truth. Read [Limits](#limits) before quoting the numbers.

## Pre-registered bar (fixed before any run, not changed after)

The best P-chain variant must have:

1. accuracy ≥ 40/45 overall, and ≥ P-requests on each app within 1 change;
2. input tokens ≥ 30 % below P-requests **and** ≤ M3's mean;
3. no new "edited the shared component" errors.

## Setup

- **Apps, scenarios, recordings, grader:** the same as the [full evaluation](results-2026-09-27.md) (3 apps × 5 changes, `eval/grade.mjs` and the ground truth unchanged; hedging counts as wrong).
- **Base spec:** today's `requests` spec for each recorded session. Rendered today with the CLI, it is byte-identical to the spec the P-requests baseline runs received (checked for all three apps), so the conditions differ from the baseline only by the added lines.
- **Agent under test:** exactly the harness settings of `eval/run.mjs` (`claude -p`, Sonnet (`claude-sonnet-5`), medium effort, tools Read, Grep and Glob only, `--setting-sources ""`, `--safe-mode`, `--strict-mcp-config`, no session persistence, the same task prompt `eval/prompt.md` and answer schema). The only change is `--output-format stream-json --verbose`, so every tool call is logged. The `init` event of every run lists only `Glob, Grep, Read, StructuredOutput` and no MCP server. CLI 2.1.258.
- **Runs:** 3 P-chain conditions and M3 × 3 apps × 3 runs = 36 runs, 4 at a time, below-normal priority. All 36 returned a structured answer. Cost: $2.34 for the runs, $0.10 for the M3 writer calls, $0.04 for one flag check.
- **Baselines:** P-requests and M2 are **recorded numbers**, not re-run: the P-requests runs after the context fix (shadcn-admin and flowbite from `eval/.runs/followup-2026-09-27/`, vuestic-admin from `eval/.runs/full-2026-09-27/`; the vuestic session was not re-recorded and its spec is the same) and M2 from the full run. They were run with `--output-format json`, so **their tool calls were not logged**: the Grep/Glob and Read columns are empty for them. They used the same model.
- **Snapshots:** every P prompt was rendered and hashed before the first run (`prompts.sha256`) and was unchanged afterwards. Product code (`packages/**`) was not touched.

### Where the chains come from

Two debate agents probed each app headless (dev server, Chromium) with the **recorded selectors** from each `session.json`. The probed elements are the recorded ones: the second "Users" card (`Dashboard.svelte:133`), the "Sales Report" link of the sales card, the Export button of Revenue Report, the Monthly Earnings chart. Every frame was then checked by hand against the source in `eval/.apps` (the build script also checks that each `file:line` holds the expected tag).

- **React 19** (shadcn-admin): the owner chain (`_debugOwner`) with each fiber's JSX call site from `_debugStack`, mapped to the original line with the module's inline source map.
- **Svelte 5** (flowbite): `__svelte_meta` (`loc` and the `parent` chain of call sites), exact lines.
- **Vue 3** (vuestic-admin): the component parent chain with each component's `__file`. Vue gives **files only**, so for vuestic P-chain-lines and P-chain-files are the same spec.

**Rendering rules** (fixed before any run):

- innermost first;
- a frame is the tag and where it is written (`<Tag> at file:line`, or `in file` without a line);
- frames in `node_modules`, `.vite` or `.svelte-kit` are dropped;
- consecutive frames in the same file are collapsed to the innermost one;
- at most 3 app-owned frames;
- a library component is prefixed with its package when the path shows it (`flowbite-svelte <TabItem>`, `recharts component` for recharts' unnamed `BarChart`).

The existing `find:` line (e.g. `component More in src/lib/More.svelte:18`) is kept as it is.

### The repo lookup (P-chain-repo only)

An adaptation of the debate agents' prototype (`locate.mjs`). It takes the element's literal: the selected text, else its text, else a word run of its text such as "Active Now". It searches for that literal as a code literal (bounded by quotes, `>`/`<` or whitespace) in the chain's files. If it is found exactly once, the spec gets `- text at: file:line`. If not found, and the element sits in a link with a non-`#` href, the lookup searches that href in the chain files and the files they import, and points at the element's text next to it (the Chats badge: `sidebar-data.ts:73`, `badge: '3'`). When a literal matches more than once, the lookup adds nothing ("Users" is written twice in `Dashboard.svelte`).

### M3: a realistic typed request

M3 is the baseline to beat. For each app, 3 separate `claude -p` calls (Sonnet, no tools, isolated as above) each wrote one request. The writer saw only the spoken sentences and, per gesture, what a person sees of the pointed element: its visible text, or a plain description when it has none ("a bar chart (no text)", "a bell icon button (no text)"). It saw no source code, no ground truth, no card or section titles and no scenario file. The instruction was verbatim: *"you are a developer typing this request quickly into Claude Code; name things by their visible text; at most 35 words; do not add positions or values unless you naturally would"*, plus "write it in the language of the sentences". The 35-word limit was enforced by resampling the same prompt, at most 3 tries per writer, keeping the shortest attempt. The flowbite writer never got under 35 words (5 changes with quoted labels), so its three texts have 44, 46 and 43 words. Every attempt is kept.

## The specs, exactly

The same element (shadcn-admin, the "3" badge of Chats in the sidebar) in each condition (the `styles:` line, identical in all four, is omitted):

```text
P-requests (baseline)
- [a] span «3» on `/`
  - find: component `Badge` (react)
  - in: `div#root › ul › li[4] › span[2]`

P-chain-lines
- [a] span «3» on `/`
  - find: component `Badge` (react)
  - code: `<span>` at `src/components/ui/badge.tsx:37` ← `<Badge>` at `src/components/layout/nav-group.tsx:62` ← `<NavGroup>` at `src/components/layout/app-sidebar.tsx:28`
  - in: `div#root › ul › li[4] › span[2]`

P-chain-files
  - code: `<span>` in `src/components/ui/badge.tsx` ← `<Badge>` in `src/components/layout/nav-group.tsx` ← `<NavGroup>` in `src/components/layout/app-sidebar.tsx`

P-chain-repo
  - code: `<span>` at `src/components/ui/badge.tsx:37` ← `<Badge>` at `src/components/layout/nav-group.tsx:62` ← `<NavGroup>` at `src/components/layout/app-sidebar.tsx:28`
  - text at: `src/components/layout/data/sidebar-data.ts:73`
```

All code lines (P-chain-lines; P-chain-files is the same without `:line`; the last column is P-chain-repo's extra line):

| App | Element | `code:` | `text at:` |
|---|---|---|---|
| shadcn | button «Download» | `<button>` at `src/components/ui/button.tsx:50` ← `<Button>` at `src/features/dashboard/index.tsx:38` ← `<OutletImpl>` at `src/components/layout/authenticated-layout.tsx:36` | `src/features/dashboard/index.tsx:38` |
| shadcn | card «Active Now…» | `<div>` at `src/components/ui/card.tsx:6` ← `<Card>` at `src/features/dashboard/index.tsx:136` ← `<OutletImpl>` at `…/authenticated-layout.tsx:36` | `src/features/dashboard/index.tsx:139` |
| shadcn | chart | recharts component at `src/features/dashboard/components/overview.tsx:57` ← `<Overview>` at `src/features/dashboard/index.tsx:168` ← `<OutletImpl>` at `…/authenticated-layout.tsx:36` | (none) |
| shadcn | badge «3» | see above | `src/components/layout/data/sidebar-data.ts:73` |
| shadcn | «You made 265 sales this month.» | `<div>` at `src/components/ui/card.tsx:42` ← `<CardDescription>` at `src/features/dashboard/index.tsx:174` ← `<OutletImpl>` at `…/authenticated-layout.tsx:36` | `src/features/dashboard/index.tsx:175` |
| vuestic | «Export» | `<VaButton>` in `src/pages/admin/dashboard/cards/RevenueReport.vue` ← `<RevenueReport>` in `src/pages/admin/dashboard/Dashboard.vue` ← `<Dashboard>` in `src/layouts/AppLayout.vue` | `…/cards/RevenueReport.vue:7` |
| vuestic | «Employees» | `<p>` in `src/pages/admin/dashboard/DataSectionItem.vue` ← `<DataSectionItem>` in `src/pages/admin/dashboard/DataSection.vue` ← `<DataSection>` in `src/pages/admin/dashboard/Dashboard.vue` | `src/pages/admin/dashboard/DataSection.vue:61` |
| vuestic | canvas | `<canvas>` in `src/components/va-charts/chart-types/LineChart.vue` ← `<LineChart>` in `src/components/va-charts/VaChart.vue` ← `<VaChart>` in `src/pages/admin/dashboard/cards/MonthlyEarnings.vue` | (none) |
| vuestic | «2+» | `<VaBadge>` in `src/components/navbar/components/dropdowns/NotificationDropdown.vue` ← `<NotificationDropdown>` in `…/components/AppNavbarActions.vue` ← `<AppNavbarActions>` in `src/components/navbar/AppNavbar.vue` | `…/dropdowns/NotificationDropdown.vue:6` |
| vuestic | «Total earnings» | `<p>` in `src/pages/admin/dashboard/cards/RevenueReport.vue` ← `<RevenueReport>` in `…/Dashboard.vue` ← `<Dashboard>` in `src/layouts/AppLayout.vue` | `…/cards/RevenueReport.vue:14` |
| flowbite | link «Sales Report» | `<a>` at `src/lib/More.svelte:18` ← `<More>` at `src/lib/ChartWidget.svelte:27` ← `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112` | `src/lib/ChartWidget.svelte:27` |
| flowbite | tab «Top customers» | flowbite-svelte `<TabItem>` at `src/lib/Stats.svelte:55` ← `<Stats>` at `…/Dashboard.svelte:113` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14` | `…/Dashboard.svelte:79` (the tab titles) |
| flowbite | h5 «Users» | flowbite-svelte `<Heading>` at `src/lib/ProductMetricCard.svelte:11` ← `<ProductMetricCard>` at `…/Dashboard.svelte:133` ← `<Dashboard>` at `…/+page.svelte:14` | (none: two matches) |
| flowbite | bell button | flowbite-svelte `<ToolbarButton>` at `src/lib/NotificationList.svelte:10` ← `<NotificationList>` at `src/routes/(sidebar)/Navbar.svelte:119` ← `<Navbar>` at `src/routes/(sidebar)/+layout.svelte:19` | (none) |
| flowbite | «Sales this week» | flowbite-svelte `<P>` at `src/lib/ChartWidget.svelte:19` ← `<ChartWidget>` at `…/Dashboard.svelte:112` ← `<Dashboard>` at `…/+page.svelte:14` | `…/Dashboard.svelte:112` |

The added lines make the spec about 1,000 characters longer (P-chain-repo: ~1,200), roughly 300 tokens.

The M3 requests, as written (shadcn and vuestic ≤ 35 words; flowbite the shortest of 3 tries):

- **shadcn-admin**
  1. Pon el botón «Download» en verde, quita la tarjeta «Active Now», cambia el gráfico de barras a líneas, quita el badge «3» del menú izquierdo, y cambia el texto a «Últimas ventas del mes».
  2. Pon el botón «Download» en verde, quita la tarjeta «Active Now», cambia el gráfico de barras a líneas, elimina el badge «3» del menú lateral y cambia el texto a «Últimas ventas del mes».
  3. Pon el botón «Download» en verde, quita la tarjeta «Active Now», cambia el gráfico de barras a líneas, quita el badge «3» del menú, y cambia el texto a «Últimas ventas del mes».
- **vuestic-admin**
  1. Unos cambios en el dashboard: el botón «Export» que ponga «Descargar CSV», quitar la tarjeta «Employees», el gráfico de líneas pasarlo a barras, quitar el badge rojo «2+», y cambiar «Total earnings» por «Ingresos totales».
  2. Unos cambios en el dashboard: el botón «Export» que ponga «Descargar CSV», quita la tarjeta «Employees», el gráfico de líneas mejor en barras, quita el badge rojo «2+», y «Total earnings» cámbialo a «Ingresos totales».
  3. Cambia el botón «Export» a «Descargar CSV», quita la tarjeta «Employees», el gráfico de líneas pásalo a barras, quita el badge rojo «2+» de arriba, y cambia «Total earnings» a «Ingresos totales».
- **flowbite-svelte-admin**
  1. Cambia el enlace «Sales Report» a "Ver informe completo". La pestaña «Top customers» debe salir abierta por defecto. Elimina la tarjeta duplicada «Users». Añade puntito rojo al icono de campana cuando haya avisos nuevos. Cambia subtítulo «Sales this week» por "Ventas de la semana".
  2. Cambia el enlace «Sales Report» a "Ver informe completo". La pestaña «Top customers» debe estar abierta por defecto. Borra la tarjeta duplicada «Users». Al icono de campana ponle un puntito rojo cuando haya avisos nuevos. Cambia el subtítulo «Sales this week» por "Ventas de la semana".
  3. Cambios en la portada: enlace «Sales Report» que ponga "Ver informe completo"; pestaña «Top customers» abierta por defecto; borra la tarjeta duplicada «Users»; icono de campana con puntito rojo si hay avisos nuevos; subtítulo «Sales this week» cámbialo por "Ventas de la semana".

## Results

Means per run (9 runs per condition, 45 changes). Input tokens are uncached + cache write + cache read, as the CLI reports them.

| Condition | Correct | Input tokens | vs P-requests | Output | Cost (USD) | Turns | Time (s) | Grep+Glob | Read | Grep+Glob before the first read of a ground-truth file |
|---|---|---|---|---|---|---|---|---|---|---|
| P-requests (recorded) | 43/45 | 93.7 k | – | 2.4 k | 0.101 | 12.3 | 30 | not logged | not logged | not logged |
| M2, careful written (recorded, upper bound) | 43/45 | 65.3 k | −30 % | 1.9 k | 0.069 | 10.6 | 21 | not logged | not logged | not logged |
| P-chain-lines | 43/45 | 39.7 k | −58 % | 1.4 k | 0.066 | 6.8 | 14 | 0.2 | 4.6 | 0.0 |
| P-chain-files | 43/45 | 38.4 k | −59 % | 1.4 k | 0.060 | 7.1 | 14 | 0.2 | 4.9 | 0.0 |
| **P-chain-repo** | **44/45** | **39.9 k** | **−57 %** | 1.3 k | 0.049 | 6.8 | 15 | 0.2 | 4.6 | 0.0 |
| M3, realistic typed | 35/45 | 90.5 k | −3 % | 2.6 k | 0.085 | 14.8 | 31 | 8.3 | 4.4 | 4.1 |

Input token breakdown (uncached / cache write / cache read, k): P-requests 0.0 / 14.8 / 78.9; P-chain-lines 0.0 / 10.9 / 28.8; P-chain-files 0.0 / 9.4 / 29.1; P-chain-repo 0.0 / 6.6 / 33.3; M3 0.0 / 10.4 / 80.0.

Per app (correct per run; mean input tokens, per run in brackets):

| App | P-requests | M2 | P-chain-lines | P-chain-files | P-chain-repo | M3 |
|---|---|---|---|---|---|---|
| shadcn-admin | 15/15 · 87.9 k (82, 80, 102) | 15/15 · 33.7 k | 13/15 (5, 3, 5) · 51.1 k (64, 25, 64) | 13/15 (5, 3, 5) · 51.9 k (64, 28, 64) | **15/15 · 40.0 k (72, 24, 25)** | 13/15 · 58.3 k (62, 79, 34) |
| vuestic-admin | 15/15 · 96.5 k (82, 117, 91) | 14/15 · 60.9 k | 15/15 · 39.0 k (28, 63, 27) | 15/15 · 34.5 k (28, 28, 48) | **15/15 · 38.3 k (37, 41, 37)** | 11/15 (2, 5, 4) · 91.2 k (104, 77, 93) |
| flowbite-svelte-admin | 13/15 · 96.6 k (95, 133, 61) | 14/15 · 101.4 k | 15/15 · 29.0 k (29, 29, 29) | 15/15 · 28.9 k (29, 29, 29) | **14/15 (5, 4, 5) · 41.3 k (48, 47, 29)** | 11/15 (3, 4, 4) · 121.8 k (86, 158, 121) |

Tool calls per run, per app (Grep+Glob / Read / Grep+Glob before the first ground-truth read):

| App | P-chain-lines | P-chain-files | P-chain-repo | M3 |
|---|---|---|---|---|
| shadcn-admin | 0.7 / 3.3 / 0 | 0.7 / 3.7 / 0 | 0.7 / 3.3 / 0 | 6.3 / 3.0 / 4.3 |
| vuestic-admin | 0 / 5.0 / 0 | 0 / 5.7 / 0 | 0 / 4.7 / 0 | 6.7 / 5.3 / 3.7 |
| flowbite-svelte-admin | 0 / 5.3 / 0 | 0 / 5.3 / 0 | 0 / 5.7 / 0 | 12.0 / 5.0 / 4.3 |

Time and cost per run, per app, are in `eval/.runs/stage0-2026-09-27/summary.md` and `stage0-analysis.json`.

Per change (correct runs out of 3):

| Change | P-requests | M2 | P-chain-lines | P-chain-files | P-chain-repo | M3 |
|---|---|---|---|---|---|---|
| shadcn · Download green | 3 | 3 | 3 | 3 | 3 | 3 |
| shadcn · remove Active Now | 3 | 3 | 2* | 2* | 3 | 3 |
| shadcn · Overview to lines | 3 | 3 | 3 | 3 | 3 | 3 |
| shadcn · Chats badge | 3 | 3 | **2** | **2** | 3 | 3 |
| shadcn · Recent Sales description | 3 | 3 | 3 | 3 | 3 | 1 |
| vuestic · Export label | 3 | 3 | 3 | 3 | 3 | 2 |
| vuestic · remove Employees | 3 | 3 | 3 | 3 | 3 | 2 |
| vuestic · Monthly Earnings bars | 3 | 2 | 3 | 3 | 3 | 2 |
| vuestic · bell badge | 3 | 3 | 3 | 3 | 3 | 2* |
| vuestic · Total earnings label | 3 | 3 | 3 | 3 | 3 | 3 |
| flowbite · Sales Report link | 2 | 3 | 3 | 3 | 2 | **0** |
| flowbite · Top customers tab | 3 | 2 | 3 | 3 | 3 | 3 |
| flowbite · remove 2nd Users card | 3 | 3 | 3 | 3 | 3 | 3 |
| flowbite · bell dot | 3 | 3 | 3 | 3 | 3 | 3 |
| flowbite · Sales this week subtitle | 2 | 3 | 3 | 3 | 3 | 2 |

\* A grader side effect, the same in every condition: one wrong item whose `request` also matches another change's topic counts against both changes. In shadcn P-chain-lines r2 and P-chain-files r2, the single wrong badge item ("quitar el número…", in `nav-group.tsx`) also fails "remove Active Now", so each of those runs scores 3/5 for one mistake (4/5 in substance). The same happens in vuestic M3 r1 (2/5 by the grader, 3/5 in substance). The grader was not changed.

## The bar

| Criterion | P-chain-lines | P-chain-files | **P-chain-repo** |
|---|---|---|---|
| ≥ 40/45 overall | 43 ✓ | 43 ✓ | 44 ✓ |
| ≥ P-requests on each app within 1 change (15 / 15 / 13) | 13 / 15 / 15 ✗ (shadcn −2) | 13 / 15 / 15 ✗ (shadcn −2) | 15 / 15 / 14 ✓ |
| input ≥ 30 % below P-requests (≤ 65.6 k) | 39.7 k ✓ | 38.4 k ✓ | 39.9 k ✓ (per app −55 %, −60 %, −57 %) |
| input ≤ M3's mean (90.5 k) | ✓ | ✓ | ✓ |
| no new "edited the shared component" errors | ✗ (shared `NavBadge`/`Badge`, 1 run) | ✗ (shared `NavBadge`, 1 run) | ✓ |

**P-chain-repo, the best variant (highest accuracy, same tokens), meets the bar.** Its one error (below) is the same kind P-requests already made, not an edit of a shared component. The chain without the repo lookup does not meet the bar.

Shared constructs that appear in the chains and were never edited: `components/ui/button.tsx` and `card.tsx` (first frame for Download, Active Now and the description: 0 of 27 runs), `More.svelte` (first frame of the Sales Report link: 0 of 9) and `DataSectionItem.vue` (first frame of Employees: 0 of 9). The one that was edited is `nav-group.tsx`: 2 of 6 runs without the lookup, 0 of 3 with it.

## Per-app notes

- **shadcn-admin.**
  - Four changes were right in all 9 P-chain runs.
  - The badge decided the result. The chain shows the badge's call site in the shared sidebar component (`<Badge>` at `nav-group.tsx:62`) before the component that maps the data (`<NavGroup>` at `app-sidebar.tsx:28`).
  - Without the lookup: in 4 of 6 runs the agent read `nav-group.tsx`, saw `{item.badge && <NavBadge>…}`, grepped `badge: '3'` and found `sidebar-data.ts` (64 k tokens). In the other 2 it answered the shared badge in `nav-group.tsx` (25–28 k tokens, wrong). One of those two did not even open the file: it answered `<Badge>` at `nav-group.tsx:62` straight from the chain.
  - With the lookup (`text at: sidebar-data.ts:73`): 2 of 3 runs read the data file directly (24–25 k). The third still grepped first (72 k), but got it right.
- **vuestic-admin.**
  - 15/15 in all 9 P-chain runs, with no Grep or Glob at all: the agent read 4–7 files, almost all of them named in the chains.
  - Vue gives files only, and that was enough.
  - "Employees" starts at the per-card component `DataSectionItem.vue` (a wrong file for this change). Every run went on to the data array in `DataSection.vue`, the next frame. With the lookup's `text at: DataSection.vue:61`, none of the 3 runs opened `DataSectionItem.vue`.
  - M3 lost this app mostly on unforced errors (hedging between the two Export buttons, the Employees entry given with the wrong file) and one hedge into the chart's data file.
- **flowbite-svelte-admin.**
  - P-chain-lines and P-chain-files got 15/15 at 29 k tokens in every run, reading 5–6 files with no search.
  - The "Sales Report" link was 0/6 for P before the context fix and 2/3 after. Here it is 3/3 in both: the chain names the instance (`<More>` at `ChartWidget.svelte:27`), although its first frame is the shared `More.svelte:18`.
  - P-chain-repo got 14/15. In r2 the agent answered `ChartWidget.svelte:27` (0.85) and also hedged the "Full Report" link in `Stats.svelte:84` (0.5): the same misreading of "ver informe completo" that one P-requests run made.
  - The lookup's line for "Top customers" points to the tab titles in `Dashboard.svelte:79`, not where `open` goes. It did not mislead: all 3 runs answered `Stats.svelte`.
  - P-chain-repo's higher mean (41 k vs 29 k) comes from one extra API round trip in r1 and r2 (3 calls instead of 2), with the same files read. Each round trip re-reads the cached context, so input tokens here come in steps of roughly 20 k.
  - M3 got the link 0/3. It named "Sales Report", which two cards show, and every run hedged between them.

## What this shows

- **A code pointer turns the search into a few reads.** Every P-chain run went to a ground-truth file with its first reads: 0 searches before it, 0.2 Grep/Glob per run in total. M3 made 8.3 searches per run, 4.1 of them before reaching a ground-truth file. Input tokens fell by more than half, below even the careful written request (M2, 65 k), which [ideas.md](../ideas.md) notes is an upper bound. Turns (−45 %), time (−50 %) and cost (−51 % for P-chain-repo) fell with them. This is the token lever the full evaluation asked for: `file:line` of the instance, not of the shared component.
- **Line numbers did not matter.** P-chain-lines and P-chain-files are the same on accuracy (43 and 43) and tokens (39.7 k and 38.4 k), and Vue, with files only, was the cheapest app. The agent reads whole files anyway.
- **The chain alone can point at the shared component.** When the instance's data lives outside the chain (the Chats badge comes from `sidebar-data.ts`), the frame just before the data is the shared renderer, and some runs stop there. The lookup's `text at:` line fixed this case. "Silent when not unique" kept it from guessing on the duplicate "Users" card, and none of its lines caused a wrong answer.
- **A realistic typed request is much worse than pointing.** M3 got 35/45, against 43/45 for today's P-requests and 43/45 for M2. It failed where pointing is needed: two identical links (flowbite 0/3), and "cambia el texto" without saying which text (shadcn 1/3). It cost the same tokens as P-requests. The earlier conclusion that "a careful written request is still better" held only against M2, which is an upper bound.

## Recommendation

**Build the code pointer as P-chain-repo**, under these conditions, all taken from what was tested:

1. **Dev mode only.** The chain comes from framework dev metadata: React 19 `_debugOwner`/`_debugStack`, Svelte 5 `__svelte_meta`, Vue 3 `__vueParentComponent`/`__file` and the vnode owner. Production builds have none of it, so the spec falls back to today's format.
2. **Keep the rendering rules that were tested:**
   - at most 3 app-owned frames, innermost first;
   - library frames dropped or shortened;
   - consecutive same-file frames collapsed. This rule mattered: without it the Chats badge chain would be `badge.tsx:37 ← nav-group.tsx:62 ← nav-group.tsx:77`, entirely inside the shared component. It would never reach `app-sidebar.tsx`, and the lookup would have had no import to follow to the data file.
3. **Include the repo lookup.** The chain alone failed the bar. The lookup needs the source, so it can only run where the spec is rendered next to the code: the CLI (`pointcast process`) or the MCP server. The extension's clipboard copy alone cannot produce it, and without it the extension would ship the variant that failed. Decide this before building.
4. **Lines are optional.** Files were enough. Svelte gives lines for free; React needs a source-map lookup for them (the module path already gives the file). The variant that passed had lines. Files plus the lookup was not tested, but lines vs files made no difference here.
5. **Before calling it done,** re-run this comparison with chains captured by the product itself (not by a probe), on at least one app and scenario that nobody involved in designing the rules has seen.

## Limits

- **Small sample.** 3 runs per condition and app, 15 changes, one model and effort. Accuracy differences of 1–2 changes out of 45 are noise. The token effect is large and consistent: all 27 P-chain runs used fewer input tokens (at most 72 k) than 8 of the 9 P-requests runs (61–133 k).
- **The chains were not produced by pointcast.** They come from a headless probe with the recorded selectors. The rendering rules were applied by hand, before any run, but by someone who knew the ground truth, and at least one rule (the same-file collapse) turned out to decide a change. An implementation with different rules could do worse.
- **The baselines were not re-run.** P-requests and M2 are recorded numbers from earlier the same day, with the same model and harness settings, but a different output format and no tool logs. There was no same-session control.
- **M3 writers are agents, not people.** They saw only the spoken words and the element's own text, not the card titles a person would also see. The flowbite texts are over the word limit (43–46 words), which makes M3 more detailed, not less.
- **Identification only.** The agents did not implement the changes. Grading checks the element, not the action.
- **Small apps, one component per file.** In larger repos search costs more, so the saving could be larger. So could the chance that a chain frame points at a shared component.
- Raw runs, stream logs, writer inputs and outputs, prompts with hashes, the probe outputs and the scripts are in `eval/.runs/stage0-2026-09-27/` (not in git). `stage0-analysis.json` has every run's tool-call sequence.
