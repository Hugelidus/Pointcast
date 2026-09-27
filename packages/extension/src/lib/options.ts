import { DEFAULT_SENSITIVE_ATTRIBUTE, DEFAULT_SOURCE_ATTRIBUTES } from "@pointcast/core";

/** Settings that decide what is read from an element and how much of it is kept. */
export interface DescribeOptions {
  /** Attributes holding "file:line[:col]", checked in order on the element and its ancestors (D9). */
  sourceAttributes: readonly string[];
  /** Marker attribute that makes an element and its whole subtree sensitive (D8). */
  sensitiveAttribute: string;
  /** Maximum length of the sanitized HTML stored per element (D5 capture budget). */
  htmlBudget: number;
  /**
   * Replace emails, phone/card/IBAN-like numbers and token-like strings with "[redacted]" in
   * every captured text (text, label, hint, path, selector, html, selection). Off for the user's
   * own local app, where exact text is the point; meant for general websites (personal.ts).
   */
  redactPersonalData: boolean;
}

export interface CaptureOptions extends DescribeOptions {
  /**
   * Clock for atStart/atEnd. Must be wall-clock epoch ms because every extension context has
   * its own performance.now() origin (D6); injectable so tests are deterministic.
   */
  now: () => number;
  /**
   * A selection container with more descendant elements than this is "too large to describe":
   * the event then also records the start and end elements (D5).
   */
  largeContainerElements: number;
  /**
   * Also capture events that page scripts create (event.isTrusted === false). Off in real use:
   * an app's own `a.click()` (a download link, a hidden file input) is not the user pointing,
   * and a script on the page must not be able to inject events into the spec an agent reads.
   * Tests turn it on because jsdom's dispatched events are untrusted.
   */
  acceptUntrusted: boolean;
}

/**
 * code-inspector-plugin's attribute ("src/App.vue:12:5:div"): a zero-config way to get source
 * locations in Vite/webpack apps of any framework, so it is read by default too.
 */
export const CODE_INSPECTOR_ATTRIBUTE = "data-insp-path";

export const DEFAULT_DESCRIBE_OPTIONS: DescribeOptions = {
  sourceAttributes: [...DEFAULT_SOURCE_ATTRIBUTES, CODE_INSPECTOR_ATTRIBUTE],
  sensitiveAttribute: DEFAULT_SENSITIVE_ATTRIBUTE,
  htmlBudget: 2000,
  redactPersonalData: false,
};

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  ...DEFAULT_DESCRIBE_OPTIONS,
  now: () => Date.now(),
  largeContainerElements: 40,
  acceptUntrusted: false,
};
