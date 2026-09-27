import type { UndoneEvent } from "../recorder-state";

export interface UndoFeedbackDependencies {
  /** Outlines the element whose gesture was removed (flash.ts, undone style). */
  flash: (target: Element) => void;
  /** Shows what was undone in the pill. */
  notice: (text: string) => void;
  /** Whether the user can see this page now; only visible pages say what was undone. */
  isVisible: () => boolean;
}

export interface UndoFeedback {
  /** The recorder accepted the gesture on `target` as event `id`. */
  remember(id: string, target: Element): void;
  /** A new recording started: ids restart at e1, so the old ones mean nothing any more. */
  reset(): void;
  /** An Undo happened (in any tab): flash the element if this page captured it, and say so. */
  undone(event: UndoneEvent): void;
}

/**
 * The page's side of Undo. The recorder only has sanitized descriptions, so the element to flash
 * can only be found by the content script that captured it: it remembers which element became
 * which event id. WeakRefs, so a removed element (a closed dialog) is not kept alive.
 *
 * The message goes to every visible page, not just the one that captured the gesture: after a
 * navigation that page is gone, and the user pressed Undo while looking at the current one.
 */
export function createUndoFeedback(deps: UndoFeedbackDependencies): UndoFeedback {
  const targets = new Map<string, WeakRef<Element>>();
  return {
    remember(id, target) {
      targets.set(id, new WeakRef(target));
    },
    reset() {
      targets.clear();
    },
    undone({ id, summary }) {
      const target = targets.get(id)?.deref();
      // The id is free again: the next gesture reuses it (offscreen/event-log.ts).
      targets.delete(id);
      if (target?.isConnected) deps.flash(target);
      if (target || deps.isVisible()) deps.notice(`Undone: ${summary}`);
    },
  };
}
