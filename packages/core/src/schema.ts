/**
 * Data contract between the extension (producer) and the CLI (consumer).
 * See docs/session-format.md for the prose version. All times are integer milliseconds.
 */

/**
 * Version of the session package format (session.json) that the extension writes.
 * Bump it on any breaking change to these types.
 *
 * - 1: `audio` always present; the CLI transcribes it into words.json.
 * - 2 (2026-09-27): `audio` is optional. The extension transcribes in the browser and saves
 *   session.json + words.json + session.md, plus the audio only when asked to keep it.
 *
 * Readers accept every version listed in `SessionFile.schemaVersion`.
 */
export const SCHEMA_VERSION = 2;

/** Milliseconds relative to t0, the moment the audio recorder actually started. */
export type Ms = number;

/**
 * How the user pointed at something.
 * - point:  Alt+click; the click is cancelled, so the app does not react.
 * - click:  plain click; the app reacts normally.
 * - select: drag (or double-click) text selection.
 */
export type Gesture = "point" | "click" | "select";

/**
 * How the user said what they wanted (since extension 0.4.0).
 * - voice: they spoke; the transcript (words.json) carries the request and the events are placed in it.
 * - typed: they typed a note for each gesture (`CapturedEvent.note`); there is no audio and no
 *   words.json, and every noted event is a request of its own.
 */
export type InputMode = "voice" | "typed";

/**
 * How the agent is told to apply the requests: the instruction line of the `requests` spec's
 * preamble (D5 note 2026-09-29, docs/eval/results-2026-09-29-instruction-style.md).
 * - intent: the elements say where; a request about an existing element changes exactly that, a
 *   request for something new is built well, in the app's own style. The default.
 * - precise: change only the referenced elements, and only as asked (the only line up to 0.8).
 */
export type InstructionStyle = "intent" | "precise";

export const INSTRUCTION_STYLES: readonly InstructionStyle[] = ["intent", "precise"];

/** What a session without `instructionStyle` renders, and the popup's default. */
export const DEFAULT_INSTRUCTION_STYLE: InstructionStyle = "intent";

/** `value` when it names an instruction style, else undefined. */
export function parseInstructionStyle(value: unknown): InstructionStyle | undefined {
  return (INSTRUCTION_STYLES as readonly unknown[]).includes(value) ? (value as InstructionStyle) : undefined;
}

/**
 * Longest note kept, in characters (UTF-16 code units, like .length). A note is a sentence or
 * a paragraph about one element; a cap keeps a pasted log from bloating the spec.
 */
export const NOTE_MAX_CHARS = 2000;

/** Location in the app's source code, read from an attribute such as data-source="src/App.tsx:12:5". */
export interface SourceRef {
  file: string;
  line?: number;
  column?: number;
  /** Attribute the value was read from, e.g. "data-source". */
  attribute: string;
  /** 0 = the element itself, 1 = its parent, and so on. */
  distance: number;
}

/** Everything captured about one DOM element. Already sanitized: nothing sensitive may reach this object. */
export interface ElementInfo {
  /** Lowercase tag name. */
  tag: string;
  /** Visible text, whitespace-collapsed and trimmed. Empty string when redacted. */
  text: string;
  /** Human label: aria-label, associated <label>, title, placeholder or alt. */
  label?: string;
  /** Extra context that pays off: the column header for a table cell, the form for a submit button. */
  hint?: string;
  /**
   * Title of the card or section around the element, at most 60 characters: the aria-label or
   * aria-labelledby of the nearest named container, or the heading (h1–h6, role=heading) that
   * titles the nearest container with one, plus a short subtitle right after it, e.g.
   * "$45,385 · Sales this week". Tells apart two instances of a shared component (two «Sales
   * Report» links in two cards). Absent when nothing titles the element below <main>, and in
   * sessions recorded before 2026-09-27.
   */
  context?: string;
  /**
   * For an element whose text is a short value (isShortValue: "3", "+5", "99+", "$4"), the label
   * of the list item, row, link or button it belongs to, at most 60 characters: that item's visible
   * text without the element's own, e.g. "Messages" for the «3» badge of the Messages link, or a
   * table row's `th[scope=row]` (else its first other cell) for a cell. A lone "3" is written all
   * over a codebase; next to its item it can be found. Absent when the item has no letters to
   * add, for sensitive elements, and in sessions recorded before 2026-09-27.
   */
  itemLabel?: string;
  /** CSS selector, unique in the document at capture time when selectorUnique is true. */
  selector: string;
  selectorUnique: boolean;
  /** Readable landmark path, e.g. "main › section#orders › table › thead › th[3]". */
  path: string;
  /** Sanitized, structurally trimmed outerHTML (capture budget, not render budget). */
  html: string;
  source?: SourceRef;
  /** True when the element or an ancestor is sensitive; text and html are redacted. */
  sensitive?: boolean;
  /**
   * A few computed style values, keyed by CSS property name as getComputedStyle reports them,
   * e.g. { "color": "rgb(17, 24, 39)", "font-size": "14px" }. Picked for visual requests
   * ("make this bigger"): color, background-color, font-size, font-weight, padding, margin,
   * display, width, height. Optional; absent in sessions recorded before it was captured.
   */
  styles?: Record<string, string>;
  /**
   * The framework component that rendered the element, read from the framework's own dev-mode
   * data (React, Vue, Svelte…) when the page exposes it. Absent in production builds.
   */
  component?: ComponentInfo;
  /**
   * The chain of APP-owned component instances that rendered the element, innermost first, at
   * most 3, read from the framework's dev-mode data. Each frame is where that instance is written
   * (its call site), so the agent lands on the right copy of a shared component. Library and
   * generated frames are never included. Absent without dev metadata and in older sessions.
   * Server-rendered pages (since 2026-09-28): the templates around the element, read from the
   * dev-only `<!-- pointcast:begin file="…" name="…" -->` comments pointcast-django writes, each
   * `{ file, component: <template name> }` without a line; `component.framework` is then "django".
   */
  renderedBy?: CodeFrame[];
  /**
   * Code locations found by resolving the element against the project's source (local repo,
   * dev server or GitHub). Only unambiguous matches are listed; absent when nothing was resolved.
   */
  resolved?: ResolvedLocation[];
  /**
   * Since 2026-09-28. When the one `resolved` location is a data literal with a property key
   * (`customer: "Marco Peña"`), the line of the component or template that renders that key
   * (`<td>{order.customer}</td>`), found exactly once in the innermost searched file that renders
   * it at all. Absent when there is no key, no rendering or more than one (D9 note 2026-09-28).
   */
  shownBy?: ShownByLocation;
}

/** `ElementInfo.shownBy`: the line that renders the value `resolved` points at. */
export interface ShownByLocation {
  /** The property key of the data literal, e.g. "customer". */
  key: string;
  /** Project-relative path of the component or template. */
  file: string;
  line: number;
  /** Where the source was read, as in `ResolvedLocation.via`. */
  via: "repo" | "dev-server" | "github";
  /** The source at `line`, as in `CodeFrame.snippet`; never for a sensitive element. */
  snippet?: string;
}

/** One app-owned component instance in `ElementInfo.renderedBy`. */
export interface CodeFrame {
  /** Component name as the framework reports it, e.g. "ChartWidget". */
  component?: string;
  /** Project-relative file where this instance is written, e.g. "src/routes/Dashboard.svelte". */
  file: string;
  line?: number;
  column?: number;
  /**
   * The source at `line`: that line, whitespace-collapsed and cut to 200 characters, with the
   * lines around it when it is too short to say anything alone (a bare "Export"). Set by the
   * resolver for a frame with a line whose file it read; absent otherwise, and in sessions
   * resolved before 2026-09-27.
   */
  snippet?: string;
}

/** A location in `ElementInfo.resolved`. */
export interface ResolvedLocation {
  /**
   * "text": the element's literal (text, label or href, or a short value next to its itemLabel)
   * appears exactly once in this file of the chain, or (when the chain's files have nothing) in
   * the file defining one of its components; "data": the literal lives in a data file imported by
   * one of those files, outside the component files searched. Since 2026-09-28, for an element
   * with no text of its own: "class", one of its distinctive classes (`className="orders-map"`)
   * written once in those component files, or "id", its id written once there.
   */
  kind: "text" | "data" | "class" | "id";
  /** Project-relative path. */
  file: string;
  line: number;
  /** Where the source was read. */
  via: "repo" | "dev-server" | "github";
  /** The source at `line`, as in `CodeFrame.snippet`. Absent in sessions resolved before 2026-09-27. */
  snippet?: string;
}

/** Dev-mode framework information for an element (`ElementInfo.component`). */
export interface ComponentInfo {
  /** Lowercase framework name, e.g. "react", "vue", "svelte". */
  framework: string;
  /** Component name, e.g. "OrdersTable". */
  name?: string;
  /** Source file of the component as the dev build reports it, e.g. "src/OrdersTable.tsx". */
  file?: string;
  line?: number;
  column?: number;
}

export interface SelectionInfo {
  /** Selected text, trimmed. Empty string when redacted. */
  text: string;
  /** Present only when the common container is too large to be useful (e.g. <main>). */
  start?: ElementInfo;
  end?: ElementInfo;
}

/** An event as produced by the content script, before the recorder assigns ids and relative times. */
export interface CapturedEventDraft {
  gesture: Gesture;
  /** Epoch ms (Date.now()) when the gesture started: pointerdown/mousedown for selections, the click for clicks. */
  atStart: number;
  /** Epoch ms when the gesture ended: mouseup for selections; equals atStart for clicks. */
  atEnd: number;
  /** location.href at capture time. */
  url: string;
  /** Target element for clicks; common container of the selection for selections. */
  element: ElementInfo;
  selection?: SelectionInfo;
}

/** An event as stored in session.json. */
export interface CapturedEvent {
  /** "e1", "e2", ... in capture order. */
  id: string;
  gesture: Gesture;
  tStart: Ms;
  tEnd: Ms;
  url: string;
  element: ElementInfo;
  selection?: SelectionInfo;
  /**
   * Typed sessions only: what the user typed about this gesture, trimmed, with line breaks
   * kept, at most NOTE_MAX_CHARS. The user's own words, not page content, so it is not redacted
   * (D12). Absent when they saved the gesture without a note, and in voice sessions.
   */
  note?: string;
  /**
   * Debug capture (D13, since extension 0.5.0): the page errors from a window around this gesture
   * (ERROR_WINDOW_BEFORE_MS before its start to ERROR_WINDOW_AFTER_MS after its end), deduplicated,
   * at most EVENT_ERRORS_MAX. Absent when there were none, when the setting was off, and in older
   * sessions.
   */
  errors?: CapturedError[];
}

/**
 * What went wrong on the page (D13):
 * - error: an uncaught exception (window "error" event);
 * - rejection: an unhandled promise rejection;
 * - console-error / console-warn: the page called console.error / console.warn;
 * - network: a fetch or XMLHttpRequest answered with a status of 400 or more, or failed.
 */
export type CapturedErrorKind = "error" | "rejection" | "console-error" | "console-warn" | "network";

/** A failed request, without its query values, fragment, headers or bodies (D13). */
export interface CapturedRequest {
  /** Upper case, e.g. "POST". */
  method: string;
  /**
   * The path, e.g. "/api/export"; with its host ("api.example.com/v1/orders") when it is not the
   * page's origin. Query parameter names are kept, their values never ("/api/orders?status&page").
   */
  url: string;
  /** The HTTP status; 0 when the request failed without an answer (network error, CORS, timeout). */
  status: number;
}

/** One page error captured while recording (D13). Page content: redacted like the page text on enabled sites. */
export interface CapturedError {
  kind: CapturedErrorKind;
  /** When it happened, relative to t0 (the first time, when `count` merged repeats). */
  t: Ms;
  /** One line, at most ERROR_MESSAGE_MAX_CHARS, e.g. "TypeError: x is undefined" or "POST /api/export → 500". */
  message: string;
  /** Where it was thrown or logged, project-relative: "src/components/OrdersTable.tsx:31:7". */
  source?: string;
  /** The first stack frames (at most ERROR_STACK_MAX), e.g. "OrdersTable (src/components/OrdersTable.tsx:31:7)". */
  stack?: string[];
  /** kind "network" only. */
  request?: CapturedRequest;
  /** How many times the same error happened within the window; absent means once. */
  count?: number;
}

/** A CapturedError as sent by the content script, before the recorder makes its time relative to t0. */
export type CapturedErrorDraft = Omit<CapturedError, "t" | "count"> & {
  /** Epoch ms (Date.now()) when it happened. */
  at: number;
};

/** Longest error message kept (D13), in characters. */
export const ERROR_MESSAGE_MAX_CHARS = 300;
/** Stack frames kept per error (D13). */
export const ERROR_STACK_MAX = 3;
/** Errors listed under one gesture (D13). */
export const EVENT_ERRORS_MAX = 5;
/** Errors kept in `SessionFile.errors` (D13): the most recent ones. */
export const SESSION_ERRORS_MAX = 50;
/** An error belongs to a gesture from this long before it started (D13)… */
export const ERROR_WINDOW_BEFORE_MS = 5000;
/** …to this long after it ended. */
export const ERROR_WINDOW_AFTER_MS = 3000;

/** Contents of session.json. */
export interface SessionFile {
  /** 1 or 2; see SCHEMA_VERSION for what changed. */
  schemaVersion: 1 | typeof SCHEMA_VERSION;
  /** Also the folder name, e.g. "2026-09-26_18-30-05". */
  id: string;
  /** ISO 8601 wall-clock time of t0. */
  startedAt: string;
  /** Date.now() at the recorder's start event. Event and word times are relative to it. */
  t0: number;
  durationMs: Ms;
  /** Present only when the audio file was saved (always in v1, optional since v2). */
  audio?: {
    /** File name relative to the session folder. */
    file: string;
    format: "wav";
    sampleRate: number;
    channels: number;
  };
  recorder: {
    extensionVersion: string;
    userAgent: string;
  };
  events: CapturedEvent[];
  /**
   * How the requests were given (InputMode). Absent means "voice": every session recorded
   * before typed mode existed. A typed session has no audio and no words.json.
   */
  inputMode?: InputMode;
  /**
   * The popup's "How your agent applies requests" setting when the recording stopped (added
   * after 0.8.0): which instruction line the `requests` spec's preamble carries, so the
   * clipboard, the MCP server and the CLI render the same one. Absent means "intent"
   * (DEFAULT_INSTRUCTION_STYLE); `pointcast process --style` and the MCP tools' `style` override it.
   */
  instructionStyle?: InstructionStyle;
  /**
   * Debug capture (D13, since extension 0.5.0): every page error captured while recording, in time
   * order, at most SESSION_ERRORS_MAX (the most recent). Each event's own `errors` are picked from
   * these. Absent when there were none, when the setting was off, and in older sessions.
   */
  errors?: CapturedError[];
}

/** One transcribed word. */
export interface Word {
  /** Text as produced by the engine; may carry punctuation and a leading space. */
  text: string;
  /** Relative to the start of the audio, which is t0. */
  start: Ms;
  end: Ms;
  /** Engine confidence in [0, 1] when available. */
  probability?: number;
}

/** Contents of words.json, written next to session.json by the CLI. */
export interface WordsFile {
  schemaVersion: 1;
  /** Engine and model, e.g. "transformers.js:onnx-community/whisper-base". */
  engine: string;
  /** ISO 639-1 code, e.g. "es". */
  language?: string;
  words: Word[];
  /**
   * Stretches of the recording whose transcript looked unreliable (the engine looped on a
   * phrase or produced words with impossible times) and was left out of `words`. Absent when
   * nothing was dropped, and in files written before 2026-09-28. Renderers mention them, so the
   * agent knows something may have been said there.
   */
  unreliable?: TimeSpan[];
}

/** A stretch of the recording, relative to t0. */
export interface TimeSpan {
  start: Ms;
  end: Ms;
}
