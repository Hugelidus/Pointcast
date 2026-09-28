# Escenarios para probar el puntero de código (Vue)

Tres grabaciones cortas para probar pointcast a mano sobre este dashboard (mismo diseño que
`dev/examples/react-dashboard`, en Vue 3 + SFCs). Para cada una: qué decir, dónde hacer Alt+clic, y qué
líneas de código muestra la spec.

Las líneas de cada escenario son las que da el resolver sobre el código de este ejemplo, con el
elemento tal como lo captura la extensión (su `renderedBy`, su `component.file`, su texto, su
contexto); la extensión usa el mismo resolver, leyendo el código del servidor de Vite. Las comprueba
`packages/cli/src/resolve/examples.test.ts`: si un cambio las mueve, ese test falla. Van como las
escribe la spec por defecto (formato `requests`, disposición *code-first*, en inglés), sin las
líneas `find:` e `in:` que siguen. Nota sobre Vue 3: al igual que React 19, su chain de componentes
(`renderedBy`) da el **archivo** de cada instancia pero no la **línea** (Vue no guarda la posición
del template en tiempo de ejecución; Svelte sí). Sí hay una diferencia con React: Vue expone el
archivo del **propio** componente que renderizó el elemento (`component.file`), así que "dónde está
definido" no depende de adivinar el nombre — el campo lo trae, sale en la línea `find:` y el
resolver busca en ese archivo cuando la cadena no basta.

## Escenario 1 — la misma tarjeta usada dos veces

**Qué decirías:** "esto debería llevar a la página de reportes, no solo mostrar el texto" — mientras
Alt+clic en el enlace **"View report"** de la tarjeta **Revenue** (arriba a la izquierda del
Dashboard).

**Por qué importa señalar:** `<StatCard>` se usa dos veces en `src/pages/Dashboard.vue` (líneas 12 y
13) con el mismo enlace "View report" en ambas.

**Lo que muestra la spec** (Alt+clic en el de la tarjeta Revenue):

```text
- [a] «View report» → code:
  - used at: `src/pages/Dashboard.vue` — `<StatCard>`
  - text at: `src/pages/Dashboard.vue:12` — `<StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" report-href="/reports/revenue" />`
  - within: `<Dashboard>` in `src/App.vue`
  - on screen: a «View report» in «Revenue · Last 30 days» on `/`
```

- `used at` y `within`: dónde se instancia cada `<StatCard>` y, más arriba, dónde se instancia
  `<Dashboard>`.
- `text at: src/pages/Dashboard.vue:12` — la línea de **esta** instancia (Revenue). La de Orders
  resuelve a `src/pages/Dashboard.vue:13`: cada una a su propia línea, porque cada una pasa su propio
  `report-href`, aunque compartan componente y cadena.
- El archivo del componente (`src/components/StatCard.vue`, compartido por las dos tarjetas) sale en
  `find:` como `component StatCard (vue) in src/components/StatCard.vue`; no hay línea
  `defined in` porque la cadena empieza en la instancia.

**Lo que distingue una tarjeta de la otra en la spec:** la línea `text at` y el contexto adjunto al
elemento — "Revenue · Last 30 days" contra "Orders · Last 30 days" —, no la cadena de componentes
(que es la misma, y así debe ser: es el mismo componente).

**Pedido escrito equivalente (sin señalar):** "haz que el link de view report de la tarjeta de
revenue navegue a la página de reportes en vez de solo mostrar el texto".

## Escenario 2 — el contador viene de un archivo de datos

**Qué decirías:** "este número está mal, deberían ser 5 mensajes sin leer" — mientras Alt+clic en la
insignia azul **"3"** del ítem **"Messages"** de la barra lateral.

**Por qué importa señalar:** el `3` no está en ningún componente — sale de `src/data/nav.ts`, que
`src/components/Sidebar.vue` importa. Y un `3` suelto no se puede buscar en el código: lo que lo
identifica es que es el de Messages.

**Lo que muestra la spec:**

```text
- [a] «3» → code:
  - used at: `src/App.vue` — `<Sidebar>`
  - data at: `src/data/nav.ts:18` — `{ id: "messages", label: "Messages", href: "/messages", badge: 3 },`
  - shown by: `src/components/Sidebar.vue:22` — `<span v-if="item.badge !== undefined" class="badge">{{ item.badge }}</span>`
  - on screen: span «3» next to «Messages» in «Main» on `/`
```

- `used at`: dónde se instancia el `<Sidebar>`.
- `next to «Messages»`: pointcast captura a qué ítem pertenece un valor corto como este (el texto del
  enlace sin el propio `3`).
- **`data at: src/data/nav.ts:18`** — la entrada de Messages. Sale de buscar «Messages» en
  `Sidebar.vue` (su `component.file`) y en los datos que importa, y tomar la línea de esa entrada
  donde está el `3`.
- `shown by: src/components/Sidebar.vue:22` — la línea que **muestra** ese valor (`{{ item.badge }}`,
  la clave `badge` de la entrada). Es la que hay que tocar para cambiar cómo se ve la insignia, no
  cuánto vale.
- Si haces Alt+clic en el resto del ítem (el enlace, no la insignia), sale la misma línea `data at`,
  esta vez por su `href`.

**Pedido escrito equivalente:** "cambia el contador de mensajes de la barra lateral a 5".

## Escenario 3 — dos botones "Export" que no son el mismo componente

**Qué decirías:** "este botón debería exportar también el estado del pedido, no solo el listado" —
mientras Alt+clic en el botón **"Export"** de la tabla de **Orders** (arriba de la tabla, en el
Dashboard).

**Por qué importa señalar:** hay otro botón "Export" en el panel de **Customers** (pestaña
Settings). A diferencia del Escenario 1, aquí ni siquiera es el mismo componente.

**Lo que muestra la spec** (Alt+clic en el de Orders):

```text
- [a] «Export» → code:
  - used at: `src/pages/Dashboard.vue` — `<OrdersTable>`
  - text at: `src/components/OrdersTable.vue:21` — `<button type="button" id="orders-export" class="btn btn-export">Export</button>`
  - within: `<Dashboard>` in `src/App.vue`
  - on screen: button «Export» in «Orders» on `/`
```

- `text at: src/components/OrdersTable.vue:21` — el "Export" de **este** botón. No está en ningún
  archivo de la cadena (`Dashboard.vue`, `App.vue`), así que pointcast busca también en el archivo
  del propio componente (`component.file`: `OrdersTable.vue`), que lo escribe una sola vez. El de
  `src/components/CustomersPanel.vue` ni se lee: ese componente no está en la cadena.
- Lo que distingue los dos botones en la spec, además de esa línea: el `id` (`#orders-export` frente
  a `#customers-export`), `component.file` (distinto para cada uno) y el contexto ("Orders" frente a
  "Customers").

**Pedido escrito equivalente:** "haz que el botón de exportar también incluya el estado del
pedido" — con dos "Export" en la app, no dice cuál.

## Otros elementos del dashboard (para explorar libremente)

- Tabla: `#orders-table` (`src/components/OrdersTable.vue`). Una celda con un valor corto, como el
  total «$128.00», sale `next to «A-1042»` (su fila, por la primera celda) y `text at:
  src/components/OrdersTable.vue:10`, la fila de `ORDERS`, más `shown by:
  src/components/OrdersTable.vue:36`, el `<td>{{ order.total }}</td>` que la muestra. Un nombre, como
  «Marco Peña», sale `text at: src/components/OrdersTable.vue:11` y `shown by:
  src/components/OrdersTable.vue:35` (`<td>{{ order.customer }}</td>`).
- Formulario con campo sensible: `src/components/SettingsForm.vue` (pestaña Settings) — "New
  password" (`type="password"`) y "Store API key" (`data-sensitive`) nunca se capturan.
- Gráfico de barras (SVG propio, sin librería): `src/components/SalesChart.vue`.
- Subtítulo bajo el título de una tarjeta: el `<p class="stat-subtitle">` de `StatCard.vue` (línea 8).
