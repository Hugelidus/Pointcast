import {
  attachErrors,
  cleanNote,
  parseCapturedErrorDraft,
  type CapturedError,
  type CapturedEvent,
  type CapturedEventDraft,
  type CodeFrame,
  type ComponentInfo,
} from "@pointcast/core";
import { onlyAddsLines, parseComponentInfo, parseRenderedBy } from "../lib/component-bridge";

/**
 * Errors kept while recording (D13). More than the session keeps (SESSION_ERRORS_MAX): each
 * gesture picks its own from all of these at Stop, so an early gesture keeps its errors even when
 * later ones fill the session's list.
 */
export const MAX_LOGGED_ERRORS = 200;

/**
 * Turns drafts from content scripts into session events: ids in arrival order, and times
 * relative to t0 (docs/session-format.md "Time").
 *
 * While recording, an id names one gesture for good: it is never reused or moved, even when an
 * earlier gesture is removed (Undo, a note box cancelled with Esc). Pages hold on to the ids they
 * were given (an open note box in another tab, Undo's flash), and a renumbered id would make them
 * write a note onto, or cancel, a different gesture. The session gets gapless ids e1..eN only when
 * it is built at Stop (session()).
 */
export class EventLog {
  readonly #t0: number;
  readonly #events: CapturedEvent[] = [];
  readonly #errors: CapturedError[] = [];
  #nextId = 1;

  constructor(t0: number) {
    this.#t0 = t0;
  }

  add(draft: CapturedEventDraft): CapturedEvent {
    // Arrival order, not atStart order: a selection that started earlier but ended later
    // still gets the later id, which matches the order the user finished pointing.
    const tStart = this.#relative(draft.atStart);
    const event: CapturedEvent = {
      id: `e${this.#nextId++}`,
      gesture: draft.gesture,
      tStart,
      // A malformed draft must not produce an interval that ends before it starts.
      tEnd: Math.max(tStart, this.#relative(draft.atEnd)),
      url: draft.url,
      element: draft.element,
      ...(draft.selection ? { selection: draft.selection } : {}),
    };
    this.#events.push(event);
    return event;
  }

  /** Removes and returns the last event (Undo), or undefined when there is none. */
  removeLast(): CapturedEvent | undefined {
    return this.#events.pop();
  }

  /**
   * Typed mode (D12): sets the note of event `id`, cleaned (trimmed, capped at NOTE_MAX_CHARS);
   * a blank note removes it. False when there is no such event (undone meanwhile).
   */
  setNote(id: string, note: string): boolean {
    const event = this.#events.find((e) => e.id === id);
    if (!event) return false;
    const cleaned = cleanNote(note);
    if (cleaned === undefined) delete event.note;
    else event.note = cleaned;
    return true;
  }

  /**
   * The code chain of event `id` read after the gesture (Next.js: it needed the dev server's
   * source maps, D9 note 2026-09-28). Page input, so checked by the bridge's parsers again. Only
   * for an event captured without a chain: a chain read at the gesture is never replaced, it can
   * only get lines (#addLines, React 19 on Vite). The component is replaced only by one that
   * names its file (the gesture's has the name alone).
   * False when there is no such event, or nothing to add.
   */
  setCode(id: string, component: unknown, renderedBy: unknown): boolean {
    const event = this.#events.find((e) => e.id === id);
    if (!event) return false;
    const chain = parseRenderedBy(renderedBy);
    const info = parseComponentInfo(component);
    if (event.element.renderedBy !== undefined) return this.#addLines(event, info, chain);
    const betterComponent = info?.file !== undefined && event.element.component?.file === undefined ? info : undefined;
    if (chain === undefined && betterComponent === undefined) return false;
    event.element = {
      ...event.element,
      ...(betterComponent !== undefined ? { component: betterComponent } : {}),
      ...(chain !== undefined ? { renderedBy: chain } : {}),
    };
    return true;
  }

  /**
   * React 19 on Vite (D9 note 2026-09-29): a chain read at the gesture has files without lines,
   * and the refinement maps them through the served modules' source maps. Only lines are ever
   * added: the chain and the component are taken only when they are the gesture's, frame by frame,
   * with lines where it had none (onlyAddsLines). Anything else leaves the event as captured.
   */
  #addLines(event: CapturedEvent, info: ComponentInfo | undefined, chain: CodeFrame[] | undefined): boolean {
    const before = event.element;
    const chainLines = chain !== undefined && before.renderedBy !== undefined && onlyAddsLines(before.renderedBy, chain);
    const componentLines = info !== undefined && before.component !== undefined && onlyAddsLines([before.component], [info]);
    if (!chainLines && !componentLines) return false;
    event.element = {
      ...before,
      ...(componentLines ? { component: info } : {}),
      ...(chainLines ? { renderedBy: chain } : {}),
    };
    return true;
  }

  /**
   * Removes event `id` (a note box cancelled with Esc, D12) and returns it, or undefined when
   * there is none. It is nearly always the last event, but a gesture in another tab may have come
   * after it; that one keeps its id (see above).
   */
  remove(id: string): CapturedEvent | undefined {
    const index = this.#events.findIndex((e) => e.id === id);
    if (index < 0) return undefined;
    return this.#events.splice(index, 1)[0];
  }

  /** The events so far, with the ids pages know them by (possibly with gaps). */
  get events(): readonly CapturedEvent[] {
    return this.#events;
  }

  /**
   * Debug capture (D13): something failed on a captured page. Checked and bounded again (the
   * content script built it from page input); one from before t0 is dropped. Only the most
   * recent MAX_LOGGED_ERRORS are kept, so an error loop cannot grow the log without end.
   */
  addError(draft: unknown): boolean {
    const parsed = parseCapturedErrorDraft(draft);
    if (parsed === undefined || parsed.at < this.#t0) return false;
    const { at, ...fields } = parsed;
    this.#errors.push({ ...fields, t: this.#relative(at) });
    if (this.#errors.length > MAX_LOGGED_ERRORS) this.#errors.splice(0, this.#errors.length - MAX_LOGGED_ERRORS);
    return true;
  }

  /**
   * The events for the session, renumbered e1..eN without gaps as docs/session-format.md expects,
   * each with the errors around it (D13).
   */
  session(): CapturedEvent[] {
    const events = this.#events.map((event, i) => ({ ...event, id: `e${i + 1}` }));
    return attachErrors(events, this.#errors).events;
  }

  /** SessionFile.errors (D13): the most recent errors, in time order; undefined when there were none. */
  errors(): CapturedError[] | undefined {
    return attachErrors([], this.#errors).errors;
  }

  /**
   * Clamped at 0: a gesture that began just before the recorder started (e.g. a mousedown
   * during the 100-300 ms between the Record press and t0) still belongs to the session,
   * and negative times would sit before the first audio sample.
   */
  #relative(epochMs: number): number {
    return Math.max(0, Math.round(epochMs - this.#t0));
  }
}
