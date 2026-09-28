# Session package format (v2)

A recording produces one folder, `Downloads/pointcast/<session-id>/`, or `<sessions folder>/<session-id>/` when a running pointcast MCP server received it ([below](#handoff-to-a-running-mcp-server)):

| File | Written by | Contents |
|---|---|---|
| `session.json` | extension | Metadata and captured events (`SessionFile`). |
| `words.json` | extension (v2), CLI | Transcription with word timestamps (`WordsFile`). Absent in a typed session. |
| `session.md` | extension (v2), CLI | The Markdown spec for the coding agent. |
| `audio.wav` | extension | Microphone audio, 16 kHz, mono, 16-bit PCM. Sample 0 is `t0`. Always saved in v1; in v2 only when the user keeps the audio. |

## Versions

`schemaVersion` in `session.json` says which version wrote the folder. The CLI reads both.

- **v1** (until 2026-09-27): the extension saves `audio.wav` + `session.json`; the CLI transcribes the audio into `words.json` and writes `session.md`.
- **v2** (since 2026-09-27): the extension transcribes in the browser ([D1 note](decisions.md#d1-transcription--whisper-via-transformersjs-locally)) and saves `session.json` + `words.json` + `session.md`. `audio` is optional: it is present, and `audio.wav` exists, only when the audio was saved: with the popup's *Keep audio*, when the language had to be guessed, or when transcription failed (then there is no `words.json` or `session.md`, and `pointcast process` finishes the job). Nothing else changed.

**Typed sessions** (since extension 0.4.0, [D12](decisions.md#d12-typed-mode)): the user typed a note for each gesture instead of speaking. `session.json` has `"inputMode": "typed"` and the notes in the events' `note`; the folder holds `session.json` + `session.md` only, never `words.json` or audio. Readers render such a session from `session.json` alone (every noted event is a request of its own) and never transcribe it. Both fields are optional, so `schemaVersion` stays 2: a session without `inputMode` is a voice session, and a reader that ignores the fields still loads the file.

The CLI never needs the audio when `words.json` is there: `pointcast process` re-runs fusion and rendering from `session.json` + `words.json`. `words.json` is a cache of the slow step: delete it and the CLI transcribes the audio again, which needs `audio.wav`. A folder with neither `words.json` nor audio cannot be processed, and the CLI says so. `words.json` has its own `schemaVersion`, still 1.

The session id (the folder name) is the local time of `t0`, `YYYY-MM-DD_HH-mm-ss`. When a folder with that name was already used (two sessions started within the same second), the id gets a suffix: `-2`, `-3`, and so on. Ids sort chronologically as plain text, and `pointcast process` uses that order to find the latest session.

`audio.file`, when present, is always a plain file name inside the session folder: the CLI rejects paths.

If the browser cannot convert the recording, the events are saved anyway. The raw recording is saved as `audio.webm` instead of `audio.wav`; `session.json` still names `audio.wav`, and the CLI prints the command that creates it: `ffmpeg -i audio.webm -ar 16000 -ac 1 audio.wav`.

The TypeScript types in [`packages/core/src/schema.ts`](../packages/core/src/schema.ts) are the source of truth; this page explains them.

## Handoff to a running MCP server

Since extension 0.2.0 and CLI 0.2.0, the folder is written either by Chrome's downloads or by a running `pointcast mcp`, which received the files from the extension ([D11](decisions.md#d11-handoff-to-a-running-mcp-server)). The files are identical either way. The server writes them into a hidden staging folder, `<sessions folder>/.incoming-<random>`, and renames it to `<session-id>` when all are written, so a reader never sees a half-written session, and an existing folder is never overwritten. **Readers ignore folders whose name starts with `.`**: they are deliveries in progress, or left by a crash (the server removes those older than an hour when it starts receiving).

### Protocol v1

For other clients that want to hand a session to a running pointcast MCP server. The constants and parsers are in [`packages/core/src/handoff.ts`](../packages/core/src/handoff.ts).

- **Transport.** HTTP/1.1 on `http://127.0.0.1:20547`. The server binds `127.0.0.1` only. Every request is a `POST` with `X-Pointcast-Handoff: 1`, a `Host` of exactly `127.0.0.1:20547`, and an `Origin` of `chrome-extension://<id>` for an id the server accepts (the official extension's, plus `POINTCAST_EXTENSION_IDS`). Anything else gets 403 with an empty body, except an unaccepted `chrome-extension://` origin, which gets the `unknown-extension` error below. Browsers send `Origin` on an extension's `fetch` POST only with the default referrer policy: `no-referrer` turns it into `null`. Answers never carry `Access-Control-*` headers.
- **`POST /pointcast/v1/hello`**, empty body → `200 {"app":"pointcast","protocol":1,"version":"<CLI version>"}`. Send it first: a program on the port that is not pointcast never gets the recording, and a server that refuses you or speaks another protocol is found before the upload.
- **`POST /pointcast/v1/sessions/<session-id>`** uploads one session:
  - `Content-Type: application/octet-stream` and a `Content-Length` (no chunked encoding);
  - `X-Pointcast-Files: session.json=18231,words.json=5120,session.md=2310`: the files and their byte sizes, in this order: `session.json` (required), `words.json`, `session.md`, `audio.wav` or `audio.webm` (not both), each at most once;
  - the body is the files' bytes concatenated in the header's order, so `Content-Length` equals the sum of the sizes;
  - limits: 32 MiB for each of `session.json`, `words.json` and `session.md`; 256 MiB in total.

  The server checks the headers before reading the body, then validates `session.json` (its `id` must be the URL's session id) and `words.json` as the CLI does, and that `session.md` is UTF-8. The audio is not checked. It answers `201 {"app":"pointcast","id":"<session-id>","dir":"<folder>"}`, where `dir` has the home folder written as `~`.
- **Errors** are `{"app":"pointcast","error":"<code>","message":"<one line>"}`: `unknown-extension` 403, `bad-request` 400, `length-required` 411, `too-large` 413, `exists` 409 (a folder with that session id is already there), `busy` 503 (one upload at a time), `not-found` 404 (another path, or another protocol version), `write-failed` 500. The server never renames a session: on any error, save it another way.
- **Versioning.** The major version is in the path. A client checks `protocol === 1` in the hello. A server that does not listen at all (pointcast 0.1, or `--no-handoff`) refuses the connection.

## Time

- `t0` is `Date.now()` taken in the recorder's `start` event — not when the button was pressed.
- Every other time (`tStart`, `tEnd`, word `start`/`end`) is **integer milliseconds relative to `t0`**.
- The content script only knows wall-clock time, so it sends `atStart`/`atEnd` as epoch ms (`CapturedEventDraft`); the recorder subtracts `t0` and assigns ids `e1, e2, …` in arrival order.

## Events

| Field | Meaning |
|---|---|
| `gesture` | `point` (Alt+click, cancelled) or `select` (text selection). `click` (plain click, executed) is a legacy value: sessions recorded before 2026-09-26 may contain it and still load, but new recordings never produce it ([D7](decisions.md#d7-pointing-gesture)). |
| `tStart`, `tEnd` | `point` (and legacy `click`): both equal the click time. Selections: mousedown and mouseup. |
| `url` | `location.href` when the gesture happened. SPA route changes show up here. |
| `element` | `point` (and legacy `click`): the target. Selections: the common container of the range. |
| `selection` | Selections only: the text, plus `start`/`end` elements when the container is too large to describe. |
| `note` | Optional, typed sessions only (D12): what the user typed about this gesture. The user's own words, not page content, so it is not redacted; it is cleaned (line endings as `\n`, control characters removed, trimmed) and at most 2,000 characters (`NOTE_MAX_CHARS`), cut with `…`. Absent when the gesture was saved without a note. |
| `errors` | Optional, since extension 0.5.0 ([D13](decisions.md#d13-debug-capture)): the page errors from 5 s before the gesture to 3 s after it (`ERROR_WINDOW_BEFORE_MS`, `ERROR_WINDOW_AFTER_MS`), identical ones merged into a `count`, at most 5 (`EVENT_ERRORS_MAX`), in time order. Absent when there were none. |

`inputMode` (top level, optional): `"typed"` for a typed session; absent (or `"voice"`) for a spoken one, which is every session recorded before 0.4.0.

`errors` (top level, optional, since extension 0.5.0): every page error captured while recording, in time order, at most the last 50 (`SESSION_ERRORS_MAX`). Each event's `errors` are picked from them. Absent when nothing failed, when *Capture console and network errors* was off, and in older sessions.

## Page errors

`CapturedError` (debug capture, [D13](decisions.md#d13-debug-capture)), in `SessionFile.errors` and `CapturedEvent.errors`:

| Field | Meaning |
|---|---|
| `kind` | `error` (uncaught exception), `rejection` (unhandled promise rejection), `console-error`, `console-warn`, or `network` (a fetch or XMLHttpRequest that answered 400 or more, or failed). |
| `t` | When, relative to `t0` (the first time, when `count` merged repeats). |
| `message` | One line, at most 300 characters: `TypeError: x is undefined`, the console arguments as a log line, or `POST /api/export → 500`. |
| `source` | Optional. Where it was thrown or logged: `src/components/OrdersTable.tsx:31:7`, the first frame in the app's code (not `node_modules`), project-relative; another origin keeps its host. The line is the one the browser ran, not source-mapped. |
| `stack` | Optional. The first 3 frames, `OrdersTable (src/components/OrdersTable.tsx:31:7)`. |
| `request` | `network` only: `{ method, url, status }`. `url` is the path (with its host for another origin), with query parameter names but never their values (`/api/orders?status&page`) and no fragment; `status` is 0 for a request that got no answer. Bodies and headers are never captured. |
| `count` | Optional. How many times the same error happened within the window (absent means once). |

Page output, so it is redacted like the page's text: query values, token-shaped path segments and the values of sensitive fields always; personal data too on enabled sites. Readers bound every field again and drop a malformed entry rather than the session. The `requests` format lists an event's errors last under its element (`- errors around this moment:`, one line each, with how long before or after the gesture), the classic appendix under the event (`- e1 errors around this moment:`); both end the appendix with the session's errors that were near no gesture, at most 5. Without errors, the spec is the same as before. Both fields are optional, so `schemaVersion` stays 2.

## ElementInfo

Two audiences, see [D3](decisions.md#d3-identifying-elements-grep-keys-first-unique-selector-second):

- For the agent (grep keys): `text`, `label`, `hint`, `context`, `itemLabel`, `path`, `source`.
- For machines: `selector`, `selectorUnique`.
- `html` is sanitized and structurally trimmed at capture time; the renderer trims further.

Optional fields that later versions of the extension fill (absent in older sessions; readers must not require them):

| Field | Meaning |
|---|---|
| `styles` | A few computed style values, keyed by CSS property name as `getComputedStyle` reports them: `color`, `background-color`, `font-size`, `font-weight`, `padding`, `margin`, `display`, `width`, `height`. For visual requests ("make this bigger"). |
| `context` | Since 2026-09-27. Title of the card or section around the element, at most 60 characters: the `aria-label`/`aria-labelledby` of the nearest named container, or the heading (`h1`–`h6`, `role=heading`) that titles the nearest container with one, plus the short line right after it, e.g. `"$45,385 · Sales this week"`. It tells apart two instances of a shared component (two «Sales Report» links in two cards). Only a heading before the element counts, never one in another item of the same list or grid or in a sibling card, and the search stops at `<main>`. Redacted like the other text on enabled sites. The `requests` format shows it next to the element (`a «Sales Report» in «$45,385 · Sales this week»`). |
| `itemLabel` | Since 2026-09-27. Only for an element whose visible text is a **short value**: non-empty, with no run of two or more letters (`"3"`, `"12"`, `"+5"`, `"99+"`, `"$4"`, `"•"`, `"✓"`; `isShortValue` in core). The label of the item the value belongs to, at most 60 characters: the nearest `li`, `a[href]`, `button`, `label` or `role` `listitem`/`row`/`option`/`menuitem`/`tab`/`treeitem`, within 4 levels up, read as its visible text without the element's own, e.g. `"Messages"` for the «3» badge in the Messages link. For a table cell, the row's label instead of the whole row: its `th[scope=row]`, else its first other cell (`"A-1042"` for an order's total). Absent when that text has no letter, for sensitive elements, and in older sessions. Read with the same sensitivity rules as `text` (D8) and redacted like the other text on enabled sites. A lone "3" cannot be searched in the code nor told apart from the page's other counters; the resolver looks it up through this label (rule 3b in [D9](decisions.md#d9-source-mapping)). The `requests` format shows it after the element (`span «3» next to «Messages» in «Main»`), the classic appendix as `- next to: «Messages»`. |
| `component` | Dev-mode framework information: `{ framework, name?, file?, line?, column? }`, e.g. `{ "framework": "react", "name": "OrdersTable", "file": "src/OrdersTable.tsx", "line": 12 }`. Only when the page runs a development build that exposes it. Since 2026-09-28, `framework: "django"` names a server-rendered **template** instead, from pointcast-django's markers (below): `{ "framework": "django", "name": "pim/partials/row.html", "file": "templates/pim/partials/row.html" }`, the innermost template around the element. |
| `renderedBy` | Since 2026-09-27. The chain of app-owned component instances that rendered this element, innermost first, at most 3: `[{ component?, file, line?, column?, snippet? }]`. Each frame is where that instance is written (its call site), so the agent lands on the right copy of a shared component, e.g. `[{ "component": "More", "file": "src/lib/ChartWidget.svelte", "line": 27 }, { "component": "ChartWidget", "file": "src/routes/Dashboard.svelte", "line": 112 }]`. The element's own tag is never itself a frame here (that location lives in `component`, below); a frame without `component` is an **unnamed component instance** — an anonymous library component the framework gives no name (e.g. recharts' chart, or a Vue chart wrapper) — rendered as `component at`/`in <file>`, never as the element's own `<tag>`. Read from dev-mode data only (React 19, Svelte 5, Vue 3; Vue gives files without lines). Library (`node_modules`) and generated (`.vite`, `.svelte-kit`) frames are never included, and consecutive frames in the same file are collapsed to the innermost one **before** the cap of 3, as in the [Stage 0 evaluation](eval/stage0-code-pointer-2026-09-27.md). `snippet` is the source at `line`, set by the resolver for a frame with a line whose file it read (see below). In the `requests` format's code-first layout (the default) the frames are rendered by role (`used at:`, `defined in:`, `within:`); in the dom-first layout and the classic appendix, as the `code:` line, with the element's own `file:line` prepended first, as `<tag> at file:line`, when `component` gives app code with a line (Svelte's `loc`, e.g. an `<a>` written at `src/lib/More.svelte:18` before the `<More>` frame above; React 19 and Vue currently give no line there, so nothing is prepended for them and a nameless first frame stays an unnamed component). **Server templates** (since 2026-09-28): on a page without framework chain whose server writes `<!-- pointcast:begin file="…" name="…" -->` / `<!-- pointcast:end file="…" -->` comments around each template (the dev-only [pointcast-django](../integrations/django/README.md) package does), the frames are the templates around the element, innermost first, at most 3: `[{ "file": "templates/pim/partials/row.html", "component": "pim/partials/row.html" }, { "file": "templates/pim/list.html", "component": "pim/list.html" }]`. `component` is the template's name (as `{% include %}` writes it) and `file` its path in the project, which ends with that name; neither has a line. Such a frame is rendered as ``template `file` `` (code-first: `template:` instead of `used at:`). |
| `resolved` | Since 2026-09-27. Code locations found by resolving the element against the project's source: `[{ kind, file, line, via, snippet? }]`. `kind: "text"`: the line is in one of the component files searched: a `renderedBy` file, or, when those give nothing, a file that defines one of the chain's components (rule 4 in D9). The element's literal (selected or visible text, else its label, else its link's href) is written there exactly once, or, for a short value, its `itemLabel` is, with the value in the same entry. `kind: "data"`: the line is outside the component files searched, in a data module (`.ts`, `.js`, `.json`…) that one of them imports directly: the element's link href is written there once and the line is the element's text next to it (`badge: '3'` in `sidebar-data.ts`), or its `itemLabel` is and the line is the value in that entry (`badge: 3` in `data/nav.ts`). `via` says where the source was read: `"repo"` (CLI or MCP server on the local checkout), `"dev-server"` (the extension), `"github"`. **Only unambiguous matches are listed**: a literal written twice gives nothing rather than a guess, and `resolved` is absent when nothing was found. `snippet` is the source at `line` (below). Rendered as `text at:` / `data at:` lines, with the snippet in the code-first layout. The rules are in [D9](decisions.md#d9-source-mapping). |
| `shownBy` | Since 2026-09-28. Optional. When `resolved` is exactly one location and its line writes the element's text as the value of exactly one property (`customer: "Marco Peña"`, `"customer": "…"`, `badge: 3`), the line that **renders** that key: `{ key, file, line, via, snippet? }`, e.g. `{ "key": "customer", "file": "src/components/OrdersTable.tsx", "line": 38, "via": "repo", "snippet": "<td>{order.customer}</td>" }`. `resolved` says where the value lives; `shownBy` says where it is displayed, for a request about how it is shown (link it, format it, badge it). Searched only in the component files the resolver already read for `resolved` (the chain, or the chain plus the files defining its components), innermost first, and never in data modules; counted forms: `{x.key}`, `{key}`, `{x?.key}`, Svelte's `{@html x.key}` (JSX, Svelte) and `{{ x.key }}` with filters (Vue, Django, Jinja), as element content, not in attributes, comments or script. Set only when the first file that renders the key renders it exactly once; absent when there is no key (a value in an array, a JSX text, a prop), no such rendering, or more than one. No snippet for a sensitive element. Rendered as a `shown by:` line after `text at:` / `data at:`, with the snippet in the code-first layout. See the [D9 note](decisions.md#d9-source-mapping) of 2026-09-28. |

Both are absent in older sessions and in production builds; without them the spec renders byte-identical to before.

**Snippets** (`CodeFrame.snippet`, `ResolvedLocation.snippet`, since 2026-09-27; absent in sessions resolved before). The resolver keeps the line it points at from the files it already read, so there are no extra reads: that line, whitespace-collapsed and cut to 200 characters, plus the non-blank lines just before and after it when it is shorter than 16 characters (a bare `Export` becomes `<Button variant="primary" onclick={exportRows}> Export </Button>`, `badge: '3',` becomes `url: '/chats', badge: '3', icon: MessagesSquare,`). A frame gets one only when it has a line (Svelte, Stage 0 chains; Vue and React 19 give none) and its file was read, and a sensitive element (D8) never gets one: its line could hold the text capture redacted. They are the user's own source lines and stay with the session like the rest of it: in `session.json` and the spec, and nowhere else. The rest of each file is never kept. See the [D9 note](decisions.md#d9-source-mapping) on the code-first layout.

`component.file`, `source.file` (the `SourceRef` under `element.source`), and the files in `renderedBy` and `resolved` are always project-relative, e.g. `src/OrdersTable.tsx`, never the machine's absolute path — even though Vue, Svelte and React dev builds (and a page's own source attribute) can report an absolute one. They are normalized at capture time and again when rendered, so a session recorded before this normalization existed still renders safely (D8).

**Privacy invariant:** nothing in a session may contain a form field value or the text of a sensitive element (D8). Sensitive elements keep `tag`, `selector`, `path` and `label`, with `text: ""`, redacted `html` and `sensitive: true`.

## Words

`words.json` (`WordsFile`, `schemaVersion` 1):

| Field | Meaning |
|---|---|
| `engine` | Engine and model, e.g. `local:Xenova/whisper-base`. |
| `language` | ISO 639-1 code. Absent when nothing was said and no language was chosen. |
| `words` | `{ text, start, end, probability? }` in time order; `text` keeps the engine's punctuation and leading space. |
| `unreliable` | Optional (since 2026-09-28). Stretches `{ start, end }` whose transcript looked unreliable and was left out of `words`: the engine looped on a phrase, or produced a run of words with no duration ([D1 note](decisions.md#d1-transcription--whisper-via-transformersjs-locally)). `session.md` mentions them in one line, so the agent knows something may be missing there, and the popup and the CLI warn. Absent when nothing was dropped. |

Older readers ignore `unreliable`, and files written before it existed have none, so `schemaVersion` stays 1.

## Example

A v2 session saved without its audio, so there is no `audio` field:

```json
{
  "schemaVersion": 2,
  "id": "2026-09-26_18-30-05",
  "startedAt": "2026-09-26T16:30:05.123Z",
  "t0": 1790440205123,
  "durationMs": 14250,
  "recorder": { "extensionVersion": "0.1.0", "userAgent": "Mozilla/5.0 …" },
  "events": [
    {
      "id": "e1",
      "gesture": "select",
      "tStart": 3820,
      "tEnd": 4410,
      "url": "http://localhost:5500/",
      "element": {
        "tag": "th",
        "text": "Quantity",
        "selector": "#orders-table > thead > tr > th:nth-of-type(3)",
        "selectorUnique": true,
        "path": "main › section#orders › table#orders-table › thead › tr › th[3]",
        "html": "<th>Quantity</th>"
      },
      "selection": { "text": "Quantity" }
    }
  ]
}
```

A typed session has `"inputMode": "typed"` at the top level, no `audio`, and a `note` in the events that have one, e.g. `"note": "Make this column sortable"`.

With the audio saved, `session.json` also has `"audio": { "file": "audio.wav", "format": "wav", "sampleRate": 16000, "channels": 1 }`, as every v1 session does. `dev/fixtures/sessions/e2e-es` (v1, with audio) and `dev/fixtures/sessions/e2e-es-v2` (v2, same events and words, no audio) render the same `session.md`.
