# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.
Where the code is known, an element starts with it: prefer its "used at", "text at" and "data at" locations, and do not edit a component marked shared unless the request is about all its uses.

## Request 1

> Quita este [a] número del menú.

- [a] «3» → code:
  - used at: `src/components/layout/nav-group.tsx:62` — `return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>`
  - defined in: `src/components/ui/badge.tsx` (shared — do not change it unless asked)
  - data at: `src/components/layout/data/sidebar-data.ts:73` — `url: '/chats', badge: '3', icon: MessagesSquare,`
  - within: `<NavGroup>` at `src/components/layout/app-sidebar.tsx:28`
  - on screen: span «3» on `/`
  - find: component `Badge` (react)
  - in: `div#root › ul › li[4] › span[2]`

## Request 2

> Y este [a] texto, cámbialo por últimas ventas del mes.

- [a] div «You made 265 sales this month.» in «Recent Sales» on `/`
  - in: `main › div › div[2] › div › div › div[2]`

## Appendix

Pages by full URL: `http://127.0.0.1:5544/`
