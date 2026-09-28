# Session package format (v2)

A recording produces one folder, `Downloads/pointcast/<session-id>/`:

| File | Written by | Contents |
|---|---|---|
| `session.json` | extension | Metadata and captured events (`SessionFile`). |
| `words.json` | extension (v2), CLI | Transcription with word timestamps (`WordsFile`). |
| `session.md` | extension (v2), CLI | The Markdown spec for the coding agent. |
| `audio.wav` | extension | Microphone audio, 16 kHz, mono, 16-bit PCM. Sample 0 is `t0`. Always saved in v1; in v2 only when the user keeps the audio. |

## Versions

`schemaVersion` in `session.json` says which version wrote the folder. The CLI reads both.

- **v1** (until 2026-09-27): the extension saves `audio.wav` + `session.json`; the CLI transcribes the audio into `words.json` and writes `session.md`.
- **v2** (since 2026-09-27): the extension transcribes in the browser ([D1 note](decisions.md#d1-transcription--whisper-via-transformersjs-locally)) and saves `session.json` + `words.json` + `session.md`. `audio` is optional: it is present, and `audio.wav` exists, only when the audio was saved: with the popup's *Keep audio*, when the language had to be guessed, or when transcription failed (then there is no `words.json` or `session.md`, and `pointcast process` finishes the job). Nothing else changed.

The CLI never needs the audio when `words.json` is there: `pointcast process` re-runs fusion and rendering from `session.json` + `words.json`. `words.json` is a cache of the slow step: delete it and the CLI transcribes the audio again, which needs `audio.wav`. A folder with neither `words.json` nor audio cannot be processed, and the CLI says so. `words.json` has its own `schemaVersion`, still 1.

The session id (the folder name) is the local time of `t0`, `YYYY-MM-DD_HH-mm-ss`. When a folder with that name was already used (two sessions started within the same second), the id gets a suffix: `-2`, `-3`, and so on. Ids sort chronologically as plain text, and `pointcast process` uses that order to find the latest session.

`audio.file`, when present, is always a plain file name inside the session folder: the CLI rejects paths.

If the browser cannot convert the recording, the events are saved anyway. The raw recording is saved as `audio.webm` instead of `audio.wav`; `session.json` still names `audio.wav`, and the CLI prints the command that creates it: `ffmpeg -i audio.webm -ar 16000 -ac 1 audio.wav`.

The TypeScript types in [`packages/core/src/schema.ts`](../packages/core/src/schema.ts) are the source of truth; this page explains them.

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
| `component` | Dev-mode framework information: `{ framework, name?, file?, line?, column? }`, e.g. `{ "framework": "react", "name": "OrdersTable", "file": "src/OrdersTable.tsx", "line": 12 }`. Only when the page runs a development build that exposes it. |
| `renderedBy` | Since 2026-09-27. The chain of app-owned component instances that rendered this element, innermost first, at most 3: `[{ component?, file, line?, column?, snippet? }]`. Each frame is where that instance is written (its call site), so the agent lands on the right copy of a shared component, e.g. `[{ "component": "More", "file": "src/lib/ChartWidget.svelte", "line": 27 }, { "component": "ChartWidget", "file": "src/routes/Dashboard.svelte", "line": 112 }]`. The element's own tag is never itself a frame here (that location lives in `component`, below); a frame without `component` is an **unnamed component instance** — an anonymous library component the framework gives no name (e.g. recharts' chart, or a Vue chart wrapper) — rendered as `component at`/`in <file>`, never as the element's own `<tag>`. Read from dev-mode data only (React 19, Svelte 5, Vue 3; Vue gives files without lines). Library (`node_modules`) and generated (`.vite`, `.svelte-kit`) frames are never included, and consecutive frames in the same file are collapsed to the innermost one **before** the cap of 3, as in the [Stage 0 evaluation](eval/stage0-code-pointer-2026-09-27.md). `snippet` is the source at `line`, set by the resolver for a frame with a line whose file it read (see below). In the `requests` format's code-first layout (the default) the frames are rendered by role (`used at:`, `defined in:`, `within:`); in the dom-first layout and the classic appendix, as the `code:` line, with the element's own `file:line` prepended first, as `<tag> at file:line`, when `component` gives app code with a line (Svelte's `loc`, e.g. an `<a>` written at `src/lib/More.svelte:18` before the `<More>` frame above; React 19 and Vue currently give no line there, so nothing is prepended for them and a nameless first frame stays an unnamed component). |
| `resolved` | Since 2026-09-27. Code locations found by resolving the element against the project's source: `[{ kind, file, line, via, snippet? }]`. `kind: "text"`: the line is in one of the component files searched: a `renderedBy` file, or, when those give nothing, a file that defines one of the chain's components (rule 4 in D9). The element's literal (selected or visible text, else its label, else its link's href) is written there exactly once, or, for a short value, its `itemLabel` is, with the value in the same entry. `kind: "data"`: the line is outside the component files searched, in a data module (`.ts`, `.js`, `.json`…) that one of them imports directly: the element's link href is written there once and the line is the element's text next to it (`badge: '3'` in `sidebar-data.ts`), or its `itemLabel` is and the line is the value in that entry (`badge: 3` in `data/nav.ts`). `via` says where the source was read: `"repo"` (CLI or MCP server on the local checkout), `"dev-server"` (the extension), `"github"`. **Only unambiguous matches are listed**: a literal written twice gives nothing rather than a guess, and `resolved` is absent when nothing was found. `snippet` is the source at `line` (below). Rendered as `text at:` / `data at:` lines, with the snippet in the code-first layout. The rules are in [D9](decisions.md#d9-source-mapping). |

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

With the audio saved, `session.json` also has `"audio": { "file": "audio.wav", "format": "wav", "sampleRate": 16000, "channels": 1 }`, as every v1 session does. `fixtures/sessions/e2e-es` (v1, with audio) and `fixtures/sessions/e2e-es-v2` (v2, same events and words, no audio) render the same `session.md`.
