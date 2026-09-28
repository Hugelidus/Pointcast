import { parseCapturedErrorDraft, type CapturedErrorDraft } from "@pointcast/core";
import { DEFAULT_DESCRIBE_OPTIONS } from "../lib/options";
import {
  PAGE_ERRORS_CONTROL_EVENT,
  PAGE_ERRORS_REPORT_EVENT,
  PAGE_ERRORS_SESSION_KEY,
  type PageWindow,
} from "../lib/page-errors-main";
import { withoutQueryValues, withoutQueryValuesInText } from "../lib/page-errors-shared";
import { REDACTED_PERSONAL, redactPersonalText, redactPersonalUrl } from "../lib/personal";
import { isSensitive } from "../lib/sensitive";
import { redactUrl } from "../lib/url";

/**
 * Isolated-world half of debug capture (D13). While a recording with the setting on runs, it
 * turns the MAIN-world hook on (lib/page-errors-main.ts), and turns each report into a
 * CapturedErrorDraft for the recorder, redacted (D8):
 * - always: query values and fragments out of every URL, token-shaped path segments (redactUrl),
 *   and the current value of every sensitive field on the page (a password the app logged);
 * - on a site the user enabled (not a local dev host): personal data too, as for the page's text.
 *
 * Reports come through a DOM event any page script can dispatch too, so each one is parsed and
 * bounded like any other page input (core's parseCapturedErrorDraft): at worst a page adds lines
 * of its own output to the spec, which it could already do with console.error.
 */

export interface PageErrorsOptions {
  /** Sends one draft to the recorder (fire and forget). */
  send: (draft: CapturedErrorDraft) => void;
  /** On sites that are not local dev hosts (D8 note 2026-09-27). */
  redactPersonalData: boolean;
  sensitiveAttribute?: string;
}

export interface PageErrors {
  /** Starts forwarding what fails from `t0` on (the recording's start); idempotent. */
  start(t0: number): void;
  stop(): void;
}

/** A report is a small JSON object; anything much larger is not one. */
const MAX_REPORT_CHARS = 8000;
/** Sensitive values shorter than this are too common to replace in a message ("1234"). */
const MIN_SECRET_CHARS = 4;

export function createPageErrors(win: PageWindow, options: PageErrorsOptions): PageErrors {
  const sensitiveAttribute = options.sensitiveAttribute ?? DEFAULT_DESCRIBE_OPTIONS.sensitiveAttribute;
  let since: number | undefined;

  const text = (value: string, secrets: readonly string[]): string => {
    let clean = withoutQueryValuesInText(value);
    for (const secret of secrets) clean = clean.split(secret).join(REDACTED_PERSONAL);
    return options.redactPersonalData ? redactPersonalText(clean) : clean;
  };

  const requestUrl = (url: string): string => {
    // redactUrl first: it would write "=REDACTED" back after a secret-looking name.
    const clean = withoutQueryValues(redactUrl(url));
    return options.redactPersonalData ? redactPersonalUrl(clean) : clean;
  };

  const onReport = (event: Event) => {
    if (since === undefined) return;
    try {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "string" || detail.length > MAX_REPORT_CHARS) return;
      const draft = parseCapturedErrorDraft(JSON.parse(detail));
      // Before this recording: kept by a page hooked from an older recording's flag.
      if (draft === undefined || draft.at < since) return;
      const secrets = sensitiveValues(win.document, sensitiveAttribute);
      const redacted: CapturedErrorDraft = {
        ...draft,
        message: text(draft.message, secrets),
        ...(draft.source !== undefined ? { source: text(draft.source, secrets) } : {}),
        ...(draft.stack !== undefined ? { stack: draft.stack.map((frame) => text(frame, secrets)) } : {}),
      };
      if (draft.request) {
        const request = { ...draft.request, url: requestUrl(draft.request.url) };
        // The message repeats the request: rebuilt from the redacted parts, never the raw URL.
        const outcome = request.status === 0 ? "failed" : String(request.status);
        redacted.request = request;
        redacted.message = `${request.method} ${request.url} → ${outcome}`;
      }
      options.send(redacted);
    } catch {
      // A malformed report is dropped.
    }
  };

  const command = (detail: "start" | "stop") => {
    win.dispatchEvent(new win.CustomEvent(PAGE_ERRORS_CONTROL_EVENT, { detail }));
  };

  const flag = (on: boolean) => {
    try {
      if (on) win.sessionStorage.setItem(PAGE_ERRORS_SESSION_KEY, "1");
      else win.sessionStorage.removeItem(PAGE_ERRORS_SESSION_KEY);
    } catch {
      // No storage: pages loaded during the recording are hooked at document_idle instead.
    }
  };

  return {
    start(t0) {
      if (since !== undefined) return;
      since = t0;
      win.addEventListener(PAGE_ERRORS_REPORT_EVENT, onReport);
      flag(true);
      command("start");
    },
    stop() {
      // Also when never started here: a page hooked at document_start by a flag that a copy which
      // died left behind is released, and that flag must not hook the next load.
      since = undefined;
      win.removeEventListener(PAGE_ERRORS_REPORT_EVENT, onReport);
      flag(false);
      command("stop");
    },
  };
}

/** The current values of the page's sensitive fields (D8), longest first. */
export function sensitiveValues(doc: Document, sensitiveAttribute: string): string[] {
  const values = new Set<string>();
  for (const field of doc.querySelectorAll("input, textarea")) {
    const value = (field as HTMLInputElement).value;
    if (value.length >= MIN_SECRET_CHARS && isSensitive(field, { sensitiveAttribute })) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}
