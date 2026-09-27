import type { CapturedEventDraft } from "@pointcast/core";
import { sendMessage, type CaptureEventResult } from "../messages";
import { IDLE_STATE, type RecorderState } from "../recorder-state";
import { watchStore } from "../state-store";

/**
 * The content script's two links to the recorder: follow whether it is recording, and send
 * it captured events.
 */

/**
 * Sends a captured event straight to the offscreen recorder, which assigns its id and time.
 * Sent immediately (no batching in the page) so nothing is lost when the page unloads (D6).
 * Resolves to { accepted: false } when there is no recording to receive it.
 */
export async function sendDraft(draft: CapturedEventDraft): Promise<CaptureEventResult> {
  try {
    return (await sendMessage({ to: "offscreen", type: "capture-event", draft })) ?? { accepted: false };
  } catch {
    // No offscreen document means no recording in progress.
    return { accepted: false };
  }
}

/**
 * Calls `onChange(state)` now (after asking the service worker) and whenever the recorder state
 * changes: the content script turns capture on and off with it, and draws the pill (REC, then
 * processing, then the outcome). Returns an unsubscribe function, after which `onChange` is
 * never called, not even by an answer still on its way: a content script copy replaced by a
 * newer one must not start capturing again.
 */
export function followState(onChange: (state: RecorderState) => void): () => void {
  let following = true;
  let changed = false;
  const apply = (state: RecorderState) => {
    if (following) onChange(state);
  };

  // Subscribe before asking, so a change between the answer and the subscription is not missed.
  const unsubscribe = watchStore((changes) => {
    if (!changes.state) return;
    changed = true;
    apply(changes.state);
  });
  // Asking the service worker (instead of reading storage directly) also wakes it up, which
  // runs its startup code that grants content scripts access to chrome.storage.session.
  // A change seen in the meantime is newer than this answer, which is then dropped.
  sendMessage({ to: "background", type: "get-state" }).then(
    (state) => {
      if (!changed) apply(state ?? IDLE_STATE);
    },
    () => {
      if (!changed) apply(IDLE_STATE);
    },
  );
  return () => {
    // First, so late answers are ignored even if removing the listener throws (orphaned copy).
    following = false;
    unsubscribe();
  };
}
