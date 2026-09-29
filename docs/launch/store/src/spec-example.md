# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
The elements say WHERE. For a request about an existing element (its text, size, colour, position), change exactly that. For a request that asks for something new (a behaviour, a component, content, an animation), work out what the user wants and build it well, in the style and conventions of the rest of the app, as a good developer on this team would; you may touch other files it needs. If a request is ambiguous, ask before editing.
Where the code is known, an element starts with it: prefer its "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.

## Request 1

> This [a] should take you to a full report page instead of only showing the text.

- [a] «View report» → code:
  - used at: `src/pages/Dashboard.tsx:11` — `<StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" reportHref="/reports/revenue" />`
  - defined in: `src/components/StatCard.tsx`
  - text at: `src/components/StatCard.tsx:19` — `<a className="stat-link" href={reportHref}> View report </a>`
  - within: `<Dashboard>` at `src/App.tsx:13`
  - on screen: a «View report» in «Revenue · Last 30 days» on `/`
  - find: href `/reports/revenue` · class `stat-link` · component `StatCard` (react) in `src/components/StatCard.tsx:18`
  - in: `div#root › main › section[1] › a`
  - styles: `color: rgb(37, 99, 235); background-color: rgba(0, 0, 0, 0); font-size: 13px; font-weight: 400; display: inline`

## Request 2

> This [a] number is wrong because there should be five new messages.

- [a] «3» → code:
  - used at: `src/App.tsx:12` — `<Sidebar page={page} onNavigate={setPage} />`
  - defined in: `src/components/Sidebar.tsx` (shared — do not change it unless asked)
  - data at: `src/data/nav.ts:16` — `{ id: "messages", label: "Messages", href: "/messages", badge: 3 },`
  - shown by: `src/components/Sidebar.tsx:26` — `{item.badge !== undefined && <span className="badge">{item.badge}</span>}`
  - within: `<App>` at `src/main.tsx:7`
  - on screen: span «3» next to «Messages» in «Main» on `/`
  - find: class `badge` · component `Sidebar` (react) in `src/components/Sidebar.tsx:26`
  - in: `div#root › nav«Main» › ul › li[4] › span[2]`
  - styles: `color: rgb(255, 255, 255); background-color: rgb(37, 99, 235); font-size: 12px; font-weight: 400; padding: 1px 7px; display: block; width: 20px; height: 20px`

## Request 3

> And this [a] button should export the order status as well as the list.

- [a] «Export» → code:
  - used at: `src/pages/Dashboard.tsx:15` — `<SalesChart /> <OrdersTable /> </div>`
  - defined in: `src/components/OrdersTable.tsx`
  - text at: `src/components/OrdersTable.tsx:22` — `<button type="button" id="orders-export" className="btn btn-export"> Export </button>`
  - within: `<Dashboard>` at `src/App.tsx:13`
  - on screen: button «Export» in «Orders» on `/`
  - find: `#orders-export` · class `btn btn-export` · component `OrdersTable` (react) in `src/components/OrdersTable.tsx:21`
  - in: `div#root › main › section[2] › button#orders-export`
  - styles: `color: rgb(17, 24, 39); background-color: rgb(255, 255, 255); font-size: 13px; font-weight: 400; padding: 6px 14px; display: block; width: 68px; height: 29px`

## Appendix

Pages by full URL: `http://127.0.0.1:5174/`
