# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
The elements say WHERE. For a request about an existing element (its text, size, colour, position), change exactly that. For a request that asks for something new (a behaviour, a component, content, an animation), work out what the user wants and build it well, in the style and conventions of the rest of the app, as a good developer on this team would; you may touch other files it needs. If a request is ambiguous, ask before editing.

## Request 1

> Esto [a] me gustaría que estuviera filtrado por cantidad.

- [a] th «Quantity» (selected) on `/index.html`
  - in: `main › section#orders › table#orders-table › thead › tr › th[3]`

## Request 2

> Y además esto [a, b, c], que es [d, e] porte [f, g] solo lo filtrado.

- [a] button «Export» on `/index.html`
  - find: `#export-btn` · class `primary` · CSS module `Toolbar_export` (component Toolbar) · source `src/components/Toolbar.tsx:8` (ancestor +1)
  - in: `main › section#orders › button#export-btn`
  - heard «es porte», probably «Export»
- [b] button «Delete» on `/index.html`
  - find: class `delete-row`
  - in: `main › section#orders › table#orders-table › tbody › tr[1] › td[5] › button`
- [c] a «Customers» on `/index.html`
  - find: href `other.html`
  - in: `header › nav«Main» › a[2]`
- [d] button «View orders» (plain click) on `/other.html`
  - find: source `src/pages/Customers.tsx:21` (ancestor +2)
  - in: `main › section#customers › article[1] › button`
- [e] a «SPA demo» (plain click) on `/other.html`
  - find: href `spa.html`
  - in: `header › nav«Main» › a[3]`
- [f] button «Reports» (plain click) on `/spa.html`
  - in: `main › nav«SPA views» › button[2]`
- [g] th «Status» on `/spa.html?view=/reports`
  - find: source `src/App.tsx:40` (ancestor +5)
  - in: `main › div#view › section«Reports» › table › thead › tr › th[3]`

## Appendix

Pages by full URL: `http://127.0.0.1:5511/index.html` · `http://127.0.0.1:5511/other.html` · `http://127.0.0.1:5511/spa.html` · `http://127.0.0.1:5511/spa.html?view=/reports`
