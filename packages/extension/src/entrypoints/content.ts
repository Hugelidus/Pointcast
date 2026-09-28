import { defineContentScript } from "wxt/utils/define-content-script";
import { createCaptureController } from "../content/capture-controller";
import { flashElement } from "../content/flash";
import { createIndicator, followWithPill } from "../content/indicator";
import { followState, sendDraft } from "../content/recorder-link";
import { createUndoFeedback } from "../content/undo-feedback";
import { isLocalDevUrl, LOCAL_HOST_MATCHES } from "../hosts";
import { isCapturableUrl } from "../sites";
import { listenFor } from "../messages";
import { isRecording } from "../recorder-state";
import { watchStore } from "../state-store";

/**
 * Runs from the manifest on every page load of a local dev host, from a registered content
 * script on the sites the user enabled (background/site-scripts.ts), and is also injected by the
 * service worker into tabs that were open before the extension was installed or reloaded, or
 * before their site was enabled (background/content-scripts.ts). All paths run this same file.
 *
 * Only one copy may capture in a page, or each Alt+click would be recorded twice. There is no
 * "already loaded" flag here on purpose: WXT creates the context below BEFORE main() runs, and
 * creating it already announced this copy with a DOM event that makes every older copy of the
 * script invalidate itself (its onInvalidated callbacks run). So the newest copy always wins,
 * whether the older one is an orphan from before an extension reload or a second copy of this
 * same instance; refusing to start here would leave the page with no live copy at all. The
 * service worker avoids injecting a second copy in the first place: it injects only where no
 * copy answers its ping. Both cases are covered by dev/e2e/extension-reload.spec.ts.
 */
export default defineContentScript({
  // Local development hosts only (D8); see hosts.ts for how ports are matched. Enabled sites
  // get this file through a registered content script instead.
  matches: [...LOCAL_HOST_MATCHES],
  runAt: "document_idle",
  main(ctx) {
    const pill = followWithPill(createIndicator(document));
    const undo = createUndoFeedback({
      flash: (target) => flashElement(target, undefined, true),
      notice: (text) => pill.notice(text),
      isVisible: () => document.visibilityState === "visible",
    });
    const capture = createCaptureController(document, {
      // Fire and forget: the recorder answers asynchronously, and waiting would delay the
      // app's reaction to the click. A rejected draft (recording just stopped) is dropped;
      // an accepted one is remembered so Undo can flash its element.
      send: (draft, target) =>
        void sendDraft(draft).then((result) => {
          if (result.accepted) undo.remember(result.id, target);
        }),
      flash: (target) => flashElement(target),
      // PRIVACY (D8 note 2026-09-27): a site the user enabled is not their own dev build, so
      // text that looks like personal data (emails, phone numbers...) is redacted as well.
      options: { redactPersonalData: !isLocalDevUrl(location.href) },
    });
    // Invalidated when a newer copy starts (see above). The page is released first: those two
    // calls only touch the DOM, so they cannot fail in an orphaned copy.
    ctx.onInvalidated(() => {
      capture.stop();
      pill.stop();
    });

    // "Is a live copy here?" asked by the service worker before it injects one. An orphaned copy
    // cannot receive it, so a missing answer means the tab needs a new copy.
    const stopAnswering = listenFor("content", async () => ({ alive: true }));
    let recording = false;
    const unfollow = followState((state) => {
      // Capture runs only while recording; the pill also shows what happens after Stop.
      if (isRecording(state)) {
        // A new recording: event ids restart at e1.
        if (!recording) undo.reset();
        capture.start();
      } else {
        capture.stop();
      }
      recording = isRecording(state);
      pill.update(state);
    });
    // Extension APIs may throw in a copy cut off by an extension reload; nothing to undo then.
    const disconnect = () => {
      for (const stop of [stopAnswering, unfollow, unwatch]) {
        try {
          stop();
        } catch {
          // The listener died with the old extension instance.
        }
      }
    };
    const unwatch = watchStore((changes) => {
      if (changes.undone) undo.undone(changes.undone);
      // The user removed this site (popup, or Chrome's "Site access" menu). Chrome keeps this
      // script running until the page reloads, so it releases the page itself (D8 note).
      if (changes.sites && !isCapturableUrl(location.href, changes.sites)) {
        capture.stop();
        pill.stop();
        disconnect();
      }
    });
    ctx.onInvalidated(disconnect);
  },
});
