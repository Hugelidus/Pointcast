import { browser } from "wxt/browser";
import { IS_E2E } from "../build-env";
import { E2E_RECORDS_KEY, type E2eRecord } from "../e2e-record";

/**
 * Appends a record of a side effect the e2e build did not perform (e2e-record.ts). Other contexts
 * send an "e2e-record" message here. A no-op in the real extension, whatever a message says.
 */
export async function appendE2eRecord(record: E2eRecord): Promise<void> {
  if (!IS_E2E) return;
  const stored = await browser.storage.session.get(E2E_RECORDS_KEY);
  const records = Array.isArray(stored[E2E_RECORDS_KEY]) ? (stored[E2E_RECORDS_KEY] as E2eRecord[]) : [];
  await browser.storage.session.set({ [E2E_RECORDS_KEY]: [...records, record] });
}
