import type { CapturedEvent, CapturedEventDraft } from "@pointcast/core";

/**
 * Turns drafts from content scripts into session events: ids e1, e2, ... in arrival order,
 * and times relative to t0 (docs/session-format.md "Time").
 */
export class EventLog {
  readonly #t0: number;
  readonly #events: CapturedEvent[] = [];

  constructor(t0: number) {
    this.#t0 = t0;
  }

  add(draft: CapturedEventDraft): CapturedEvent {
    // Arrival order, not atStart order: a selection that started earlier but ended later
    // still gets the later id, which matches the order the user finished pointing.
    const tStart = this.#relative(draft.atStart);
    const event: CapturedEvent = {
      id: `e${this.#events.length + 1}`,
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

  /**
   * Removes and returns the last event (Undo), or undefined when there is none. The next event
   * reuses its id, so ids stay e1..eN without gaps, as docs/session-format.md expects.
   */
  removeLast(): CapturedEvent | undefined {
    return this.#events.pop();
  }

  get events(): readonly CapturedEvent[] {
    return this.#events;
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
