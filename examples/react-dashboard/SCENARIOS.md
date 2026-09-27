# Escenarios para probar el puntero de código (React)

Tres grabaciones cortas para probar pointcast a mano sobre este dashboard. Para cada una: qué decir,
dónde hacer Alt+clic (o seleccionar texto), y qué líneas de código muestra la spec.

Las líneas de cada escenario son las que da el resolver sobre el código de este ejemplo, con el
elemento tal como lo captura la extensión (su `renderedBy`, su texto, su contexto); la extensión usa
el mismo resolver, leyendo el código del servidor de Vite. Las comprueba
`packages/cli/src/resolve/examples.test.ts`: si un cambio las mueve, ese test falla. Van como las
escribe la spec por defecto (formato `requests`, disposición *code-first*, en inglés), sin las
líneas `find:` e `in:` que siguen. Nota sobre React 19: su chain de componentes (`renderedBy`) da el
**archivo** donde se creó cada instancia, pero no la **línea** (React 19 dejó de exponerla en
desarrollo; Vue 3 tampoco la da; Svelte sí). Por eso `used at` nunca lleva número de línea aquí —
pero `text at` / `data at` sí, porque esos salen de leer el código fuente, no del framework.

## Escenario 1 — la misma tarjeta usada dos veces

**Qué decirías (narrando mientras señalas):** "esto debería llevar a la página de reportes, no solo
mostrar el texto" — mientras Alt+clic en el enlace **"View report"** de la tarjeta **Revenue**
(arriba a la izquierda del Dashboard).

**Por qué importa señalar:** `<StatCard>` se usa dos veces en `src/pages/Dashboard.tsx` (líneas 11 y
12) con el mismo enlace "View report" en ambas. Sin señalar, "el link de view report" es ambiguo —
hay dos.

**Lo que muestra la spec** (Alt+clic en el de la tarjeta Revenue):

```text
- [a] «View report» → code:
  - used at: `src/pages/Dashboard.tsx` — `<StatCard>`
  - text at: `src/pages/Dashboard.tsx:11` — `<StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" reportHref="/reports/revenue" />`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: a «View report» in «Revenue · Last 30 days» on `/`
```

- `used at` y `within`: la cadena de componentes que lo renderizó, del más cercano al más lejano.
- `text at: src/pages/Dashboard.tsx:11` — la línea exacta de **esta** instancia (la de Revenue). Si
  señalas la tarjeta Orders en cambio, sale `src/pages/Dashboard.tsx:12`: cada instancia resuelve a
  su propia línea porque cada una pasa su propio `reportHref`, aunque la cadena de componentes sea
  idéntica en ambas.
- No hay línea `defined in`: React 19 no da el archivo del componente, y pointcast no marca
  `src/components/StatCard.tsx` como compartido sin pruebas. El nombre sí sale en `find:`
  (`component StatCard (react)`).

**Lo que distingue una tarjeta de la otra en la spec:** la línea `text at` y el contexto que
pointcast adjunta junto al elemento — "Revenue · Last 30 days" contra "Orders · Last 30 days" —, no
la cadena de componentes (que es la misma para las dos, correctamente: es el mismo componente).

**Pedido escrito equivalente (sin señalar):** "haz que el link de view report de la tarjeta de
revenue navegue a la página de reportes en vez de solo mostrar el texto" — funciona, pero exige que
quien lo escribe sepa nombrar la tarjeta correcta y ya sepa que ambas comparten componente.

## Escenario 2 — el contador viene de un archivo de datos

**Qué decirías:** "este número está mal, deberían ser 5 mensajes sin leer" — mientras Alt+clic en la
insignia azul **"3"** del ítem **"Messages"** de la barra lateral.

**Por qué importa señalar:** el `3` no está escrito en ningún componente — sale de
`src/data/nav.ts`, que `src/components/Sidebar.tsx` importa. Y un `3` suelto no se puede buscar en el
código (hay treses por todas partes): lo que lo identifica es que es el de Messages. Sin señalar, "el
contador de mensajes" no dice en qué archivo arreglarlo.

**Lo que muestra la spec:**

```text
- [a] «3» → code:
  - used at: `src/App.tsx` — `<Sidebar>`
  - data at: `src/data/nav.ts:16` — `{ id: "messages", label: "Messages", href: "/messages", badge: 3 },`
  - within: `<App>` in `src/main.tsx`
  - on screen: span «3» next to «Messages» in «Main» on `/`
```

- `used at`: dónde se instancia el `<Sidebar>` que lo renderiza.
- `next to «Messages»`: pointcast captura a qué ítem pertenece un valor corto como este (el texto del
  enlace sin el propio `3`).
- **`data at: src/data/nav.ts:16`** — la entrada de Messages; ahí es donde se cambia el número, no en
  `Sidebar.tsx`. Sale de buscar «Messages» en `Sidebar.tsx` (el archivo que define `<Sidebar>`, que
  `App.tsx` importa) y en los datos que importa, y tomar la línea de esa entrada donde está el `3`.
- Si haces Alt+clic en el resto del ítem (el enlace, no la insignia), sale la misma línea `data at`,
  esta vez por su `href`.

**Pedido escrito equivalente:** "cambia el contador de mensajes de la barra lateral a 5" — un
desarrollador con prisa probablemente edite `Sidebar.tsx` primero (es donde se ve el número en
pantalla) antes de notar que en realidad viene de `src/data/nav.ts`.

## Escenario 3 — dos botones "Export" que no son el mismo componente

**Qué decirías:** "este botón debería exportar también el estado del pedido, no solo el listado" —
mientras Alt+clic en el botón **"Export"** de la tabla de **Orders** (arriba de la tabla, en el
Dashboard).

**Por qué importa señalar:** hay otro botón "Export" en el panel de **Customers** (pestaña
Settings), escrito en otro componente (`src/components/CustomersPanel.tsx`). "El botón de exportar"
no dice cuál.

**Lo que muestra la spec** (Alt+clic en el de Orders):

```text
- [a] «Export» → code:
  - used at: `src/pages/Dashboard.tsx` — `<OrdersTable>`
  - text at: `src/components/OrdersTable.tsx:22` — `<button type="button" id="orders-export" className="btn btn-export"> Export </button>`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: button «Export» in «Orders» on `/`
```

- `text at: src/components/OrdersTable.tsx:22` — el "Export" de **este** botón. No está en ningún
  archivo de la cadena (`Dashboard.tsx`, `App.tsx`, `main.tsx`), así que pointcast busca también en
  los archivos que definen sus componentes: `OrdersTable.tsx`, importado desde `Dashboard.tsx`, lo
  escribe una sola vez. El de `CustomersPanel.tsx` ni se lee: ese componente no está en la cadena.
- Lo que distingue los dos botones en la spec, además de esa línea: el `id` (`#orders-export` frente
  a `#customers-export`), el nombre del componente y el contexto ("Orders" frente a "Customers").

**Pedido escrito equivalente:** "haz que el botón de exportar también incluya el estado del
pedido" — con dos "Export" en la app, no dice cuál.

## Otros elementos del dashboard (para explorar libremente)

- Tabla: `#orders-table` (`src/components/OrdersTable.tsx`). Una celda con un valor corto, como el
  total «$128.00», sale `next to «A-1042»` (su fila, por la primera celda) y `text at:
  src/components/OrdersTable.tsx:9`, la fila de `ORDERS`.
- Formulario con campo sensible: `src/components/SettingsForm.tsx` (pestaña Settings) — el campo
  "New password" (`type="password"`) y "Store API key" (`data-sensitive`) nunca se capturan; la spec
  dice solo "pointcast did not record this field's value or text".
- Gráfico de barras (SVG propio, sin librería): `src/components/SalesChart.tsx`.
- Subtítulo bajo el título de una tarjeta: el `<p class="stat-subtitle">` de `StatCard.tsx` (línea 16) — es la mitad del "contexto" que distingue Revenue de Orders en el Escenario 1.
