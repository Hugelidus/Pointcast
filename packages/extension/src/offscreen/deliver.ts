import type { ProcessingResult } from "../messages";

/**
 * Reporting the end of processing to the service worker ("processing-done"). The worker may be
 * restarting just when processing ends; sending the message wakes it, but a handler that failed
 * answers nothing. So the report is retried (the handler is idempotent, commands.ts
 * finishProcessing), and when every try went unanswered a last, minimal failure report follows:
 * without it the popup and the pill would say "Processing…" until the processing alarm, up to 10
 * minutes later.
 */

/** Answer of the service worker, or undefined when its handler failed; rejects when nobody listens. */
export type SendReport = (sessionId: string, result: ProcessingResult) => Promise<{ ok: true } | undefined>;

export interface DeliverDeps {
  send: SendReport;
  wait(ms: number): Promise<void>;
}

/** 1 + 2 + 4 + 8 + 16 s: long enough for a service worker restart, short next to the alarm. */
export const REPORT_ATTEMPTS = 5;

export async function deliver(sessionId: string, result: ProcessingResult, deps: DeliverDeps): Promise<boolean> {
  for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt++) {
    if (await tryReport(deps, sessionId, result)) return true;
    await deps.wait(1000 * 2 ** attempt);
  }
  // Whatever made the full report fail (a Markdown too large to store, a bug in its handling), the
  // failure report carries none of it: no files, no Markdown. A handed-off session stays handed off,
  // since its files are safe with the MCP server either way.
  return tryReport(deps, sessionId, failureReport(result));
}

async function tryReport(deps: DeliverDeps, sessionId: string, result: ProcessingResult): Promise<boolean> {
  try {
    return (await deps.send(sessionId, result))?.ok === true;
  } catch (error) {
    console.error("[pointcast] could not report the processed session", error);
    return false;
  }
}

/** The last report: the session ends, and the popup says what was lost and what was not. */
export function failureReport(result: ProcessingResult): ProcessingResult {
  const { copied, audioMs, handedOff, error, errorDetail, warning } = result;
  if (handedOff) {
    return {
      files: [],
      copied,
      audioMs,
      handedOff,
      ...(error ? { error } : {}),
      ...(error && errorDetail ? { errorDetail } : {}),
      ...(warning ? { warning } : {}),
    };
  }
  return {
    files: [],
    copied,
    audioMs,
    error: `The recording was processed, but Pointcast could not save it.${copied ? " The Markdown is still on your clipboard." : ""}`,
    errorDetail: `The service worker did not take the processed session after ${REPORT_ATTEMPTS} attempts.`,
  };
}
