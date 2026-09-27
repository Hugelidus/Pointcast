import { browser } from "wxt/browser";
import { IS_E2E } from "../build-env";
import { appendE2eRecord } from "./e2e-records";

/**
 * A system notification when processing ends, for a user who switched to their editor after
 * pressing Stop (popup setting "Notify when done"). The e2e build records it instead
 * (build-env.ts): a test must not pop notifications on the developer's screen.
 */
export async function notify(title: string, message: string): Promise<void> {
  if (IS_E2E) {
    await appendE2eRecord({ kind: "notification", title, message });
    return;
  }
  await browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("/icon/128.png"),
    title,
    message,
  });
}
