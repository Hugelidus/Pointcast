# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.
Where the code is known, an element starts with it: prefer its "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.

## Request 1

> This [a] should take you to a full report page instead of only showing the text.

- [a] «View report» → code:
  - used at: `src/pages/Dashboard.tsx` — `<StatCard>`
  - text at: `src/pages/Dashboard.tsx:11` — `<StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" reportHref="/reports/revenue" />`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: a «View report» in «Revenue · Last 30 days» on `/`
  - find: href `/reports/revenue` · class `stat-link` · component `StatCard` (react)
  - in: `div#root › main › section[1] › a`
  - styles: `color: rgb(37, 99, 235); background-color: rgba(0, 0, 0, 0); font-size: 13px; font-weight: 400; display: inline`

## Request 2

> This [a] number is wrong because there should be five new messages.

- [a] «3» → code:
  - used at: `src/App.tsx` — `<Sidebar>`
  - data at: `src/data/nav.ts:16` — `{ id: "messages", label: "Messages", href: "/messages", badge: 3 },`
  - within: `<App>` in `src/main.tsx`
  - on screen: span «3» next to «Messages» in «Main» on `/`
  - find: class `badge` · component `Sidebar` (react)
  - in: `div#root › nav«Main» › ul › li[4] › span[2]`
  - styles: `color: rgb(255, 255, 255); background-color: rgb(37, 99, 235); font-size: 12px; font-weight: 400; padding: 1px 7px; display: block; width: 20.4688px; height: 20px`

## Request 3

> And this [a] button should export the order status as well as the list.

- [a] «Export» → code:
  - used at: `src/pages/Dashboard.tsx` — `<OrdersTable>`
  - text at: `src/components/OrdersTable.tsx:22` — `<button type="button" id="orders-export" className="btn btn-export"> Export </button>`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
  - on screen: button «Export» in «Orders» on `/`
  - find: `#orders-export` · class `btn btn-export` · component `OrdersTable` (react)
  - in: `div#root › main › section[2] › button#orders-export`
  - styles: `color: rgb(17, 24, 39); background-color: rgb(255, 255, 255); font-size: 13px; font-weight: 400; padding: 6px 14px; display: block; width: 67.5781px; height: 29px`

## Appendix

Pages by full URL: `http://127.0.0.1:5174/`
