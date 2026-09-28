# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.

## Request 1

> Este [a] enlace que ponga a ver informe completo.

- [a] a «Sales Report» in «$45,385 · Sales this week» on `/`
  - find: href `#top` · component `More` (svelte) in `src/lib/More.svelte:18`
  - code: `<a>` inside `src/lib/More.svelte:18` ← `<More>` at `src/lib/ChartWidget.svelte:27` ← `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`
  - text at: `src/lib/ChartWidget.svelte:27`
  - in: `main › a`

## Request 2

> Esta [a] pestaña debería salir abierta por defecto.

- [a] button «Top customers» in «Statistics this month · Show information» on `/`
  - find: `#s3` · component `TabItem` (svelte, package `flowbite-svelte`)
  - code: flowbite-svelte `<TabItem>` at `src/lib/Stats.svelte:55` ← `<Stats>` at `src/routes/utils/dashboard/Dashboard.svelte:113` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - text at: `src/routes/utils/dashboard/Dashboard.svelte:79`
  - shown by: `src/lib/Stats.svelte:57`
  - in: `main › ul[role=tablist] › li[role=presentation][2] › button#s3`
  - html: `<button type="button" role="tab" id="s3" aria-controls="tab-panel-s1">Top customers</button>`

## Request 3

> Esta [a] tarjeta está repetida, borrala.

- [a] h5 «Users» on `/`
  - find: component `Heading` (svelte, package `flowbite-svelte`)
  - code: flowbite-svelte `<Heading>` at `src/lib/ProductMetricCard.svelte:11` ← `<ProductMetricCard>` at `src/routes/utils/dashboard/Dashboard.svelte:133` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - in: `main › h5`

## Request 4

> El [a] subtítulo de sales de Yswick, cambia lo por ventas de la semana.

- [a] p «Sales this week» in «$45,385» (selected) on `/`
  - find: component `P` (svelte, package `flowbite-svelte`)
  - code: flowbite-svelte `<P>` at `src/lib/ChartWidget.svelte:19` ← `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - text at: `src/routes/utils/dashboard/Dashboard.svelte:112`
  - in: `main › p`

## Appendix

Pages by full URL: `http://127.0.0.1:5544/`
