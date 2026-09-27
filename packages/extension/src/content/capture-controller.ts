import type { CapturedEventDraft } from "@pointcast/core";
import { startCapture, type CaptureOptions } from "../lib";

export interface CaptureController {
  /** Starts capturing gestures; calling it while already capturing does nothing. */
  start(): void;
  /** Stops capturing; the app gets every click again untouched (Alt+click included). */
  stop(): void;
}

export interface CaptureDependencies {
  /**
   * Hands a draft to the recorder. Called first, synchronously, inside the event listener.
   * `target` is the live element, kept by the page so Undo can flash it.
   */
  send: (draft: CapturedEventDraft, target: Element) => void;
  /** Visual feedback on the captured element. */
  flash: (target: Element) => void;
  options?: Partial<CaptureOptions>;
}

/**
 * Turns DOM capture on and off with the recording. Kept apart from the WXT entrypoint so the
 * wiring (start only once, send before flashing, stop cleanly) is testable in jsdom.
 *
 * Capture runs ONLY while recording: outside a recording Alt+click must behave as the browser
 * and the app define it, and no page activity should be observed at all.
 */
export function createCaptureController(doc: Document, deps: CaptureDependencies): CaptureController {
  let stopCapture: (() => void) | undefined;

  return {
    start() {
      if (stopCapture) return;
      stopCapture = startCapture(
        doc,
        (draft, target) => {
          // Send before anything else: a click on a link unloads the page right after this
          // listener returns, and the draft must already be on its way (D6).
          deps.send(draft, target);
          deps.flash(target);
        },
        deps.options,
      );
    },
    stop() {
      stopCapture?.();
      stopCapture = undefined;
    },
  };
}
