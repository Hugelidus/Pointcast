/**
 * Side effects the e2e build records instead of performing (build-env.ts): the suite runs on the
 * developer's own machine, where a test must not overwrite the real clipboard, show a system
 * notification or open a file manager window. The service worker appends the records to
 * chrome.storage.session under E2E_RECORDS_KEY (background/e2e-records.ts), where the tests read
 * and assert on them. Types only, so the e2e suite can import them.
 */
export type E2eRecord =
  | { kind: "clipboard"; text: string }
  | { kind: "notification"; title: string; message: string }
  | { kind: "show-in-folder"; downloadId: number };

export const E2E_RECORDS_KEY = "e2eRecords";
