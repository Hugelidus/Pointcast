import { IS_E2E } from "./build-env";
import type { E2eRecord } from "./e2e-record";
import { sendMessage } from "./messages";

/**
 * Copies the Markdown to the clipboard from the offscreen document, which has no focus, so
 * navigator.clipboard.writeText is refused there. Chrome's documented pattern for offscreen
 * documents (reason CLIPBOARD) is a textarea and document.execCommand("copy").
 */
export async function copyFromOffscreenDocument(text: string): Promise<void> {
  if (IS_E2E) return recordInsteadOfCopying(text);
  const area = document.createElement("textarea");
  area.value = text;
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("the browser refused to copy");
  } finally {
    area.remove();
  }
}

/** "Copy again" in the popup: a click gives the popup focus, so the async clipboard API works. */
export async function copyFromPopup(text: string): Promise<void> {
  if (IS_E2E) return recordInsteadOfCopying(text);
  await navigator.clipboard.writeText(text);
}

/** e2e builds never touch the real clipboard of the machine running the tests (build-env.ts). */
async function recordInsteadOfCopying(text: string): Promise<void> {
  const record: E2eRecord = { kind: "clipboard", text };
  await sendMessage({ to: "background", type: "e2e-record", record });
}
