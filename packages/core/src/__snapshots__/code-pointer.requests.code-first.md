# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.
Where the code is known, an element starts with it: prefer its "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.

## Request 1

> Este [a] enlace que ponga a ver informe completo.

- [a] «Sales Report» → code:
  - used at: `src/lib/ChartWidget.svelte:27` — `<More title="Sales Report" href="#top" />`
  - defined in: `src/lib/More.svelte` (shared — do not change it unless asked)
  - text at: `src/lib/ChartWidget.svelte:27` (same as used at)
  - within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`
  - on screen: a «Sales Report» in «$45,385 · Sales this week» on `/`
  - find: href `#top` · component `More` (svelte) in `src/lib/More.svelte:18`
  - in: `main › a`

## Request 2

> Esta [a] pestaña debería salir abierta por defecto.

- [a] «Top customers» → code:
  - used at: `src/lib/Stats.svelte:55` — `<TabItem class="w-full">`
  - defined in: package `flowbite-svelte`
  - text at: `src/routes/utils/dashboard/Dashboard.svelte:79` — `tab2Title: 'Top customers'`
  - within: `<Stats>` at `src/routes/utils/dashboard/Dashboard.svelte:113` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - on screen: button «Top customers» in «Statistics this month · Show information» on `/`
  - find: `#s3` · component `TabItem` (svelte, package `flowbite-svelte`)
  - in: `main › ul[role=tablist] › li[role=presentation][2] › button#s3`
  - html: `<button type="button" role="tab" id="s3" aria-controls="tab-panel-s1">Top customers</button>`

## Request 3

> Esta [a] tarjeta está repetida, borrala.

- [a] «Users» → code:
  - used at: `src/lib/ProductMetricCard.svelte:11` — `<Heading tag={headingTag}>{title}</Heading>`
  - defined in: package `flowbite-svelte`
  - within: `<ProductMetricCard>` at `src/routes/utils/dashboard/Dashboard.svelte:133` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - on screen: h5 «Users» on `/`
  - find: component `Heading` (svelte, package `flowbite-svelte`)
  - in: `main › h5`

## Request 4

> El [a] subtítulo de sales de Yswick, cambia lo por ventas de la semana.

- [a] «Sales this week» → code:
  - used at: `src/lib/ChartWidget.svelte:19` — `<P class="text-base font-light text-gray-500 dark:text-gray-300">{subtitle}</P>`
  - defined in: package `flowbite-svelte`
  - text at: `src/routes/utils/dashboard/Dashboard.svelte:112` — `<ChartWidget value={12.5} {chartOptions} title="$45,385" subtitle="Sales this week" />`
  - within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`
  - on screen: p «Sales this week» in «$45,385» (selected) on `/`
  - find: component `P` (svelte, package `flowbite-svelte`)
  - in: `main › p`

## Appendix

Pages by full URL: `http://127.0.0.1:5544/`
