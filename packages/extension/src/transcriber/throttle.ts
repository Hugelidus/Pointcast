import type { TranscriptionProgress, TranscriptionProgressListener } from "@pointcast/transcribe";

/**
 * Forwards every stage change right away, and repeated updates of the same stage (the model
 * download reports bytes many times per second) at most once per `intervalMs`. Each forwarded
 * update becomes a message to the service worker and a storage write that every open tab
 * re-renders; four a second is plenty for a progress bar.
 */
export function throttleProgress(
  forward: TranscriptionProgressListener,
  intervalMs = 250,
  now: () => number = Date.now,
): TranscriptionProgressListener {
  let lastStage: TranscriptionProgress["stage"] | undefined;
  let lastAt = Number.NEGATIVE_INFINITY;
  return (progress) => {
    const at = now();
    if (progress.stage === lastStage && at - lastAt < intervalMs) return;
    lastStage = progress.stage;
    lastAt = at;
    forward(progress);
  };
}
