/**
 * Runs async tasks one at a time, in call order. The service worker's handlers each read the
 * state, await something, and write it back; two interleaved handlers (a processing report
 * arriving while Stop still waits for the recorder's answer) would overwrite each other's
 * changes. The queue belongs to one service worker instance, like `recovered` in background.ts:
 * it orders work, it holds no session state (D6).
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
