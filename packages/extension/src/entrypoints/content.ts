import { defineContentScript } from "wxt/utils/define-content-script";
import { createCaptureController } from "../content/capture-controller";
import { flashElement } from "../content/flash";
import { createIndicator, followWithPill } from "../content/indicator";
import { createNoteBox } from "../content/note-box";
import { createPageErrors } from "../content/page-errors";
import { discardEvent, followState, sendCode, sendDraft, sendError, sendNote } from "../content/recorder-link";
import { requestRefinedFrameworkInfo } from "../lib/component-bridge";
import { createUndoFeedback } from "../content/undo-feedback";
import { isLocalDevUrl, LOCAL_HOST_MATCHES } from "../hosts";
import { isCapturableUrl } from "../sites";
import { listenFor } from "../messages";
import { capturesErrors, isRecording, isTyped } from "../recorder-state";
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
    // Typed mode (D12): each gesture opens a box for its note. Created before capture can start:
    // its window listener then runs before capture's, so a click inside the box is the box's own
    // and a press that ends up pointing again is seen before capture cancels it (note-box.ts).
    const notes = createNoteBox(document, { setNote: sendNote, discard: discardEvent });
    let typed = false;
    const capture = createCaptureController(document, {
      // Not awaited: the recorder answers asynchronously, and waiting would delay the app's
      // reaction to the click. A rejected draft (recording just stopped) is dropped; an accepted
      // one is remembered so Undo can flash its element.
      send: (draft, target) => {
        const accepted = sendDraft(draft).then((result) => {
          if (!result.accepted) return undefined;
          undo.remember(result.id, target);
          return result.id;
        });
        if (typed) notes.open(accepted, target);
        // Next.js (D9 note 2026-09-28): a React chain that needs the dev server's source maps is
        // read by the MAIN world after the gesture, and sent when it comes (before Stop, or never).
        if (draft.element.renderedBy === undefined && draft.element.component?.framework === "react") {
          void Promise.all([accepted, requestRefinedFrameworkInfo(target)]).then(([id, info]) => {
            if (id !== undefined && (info.renderedBy !== undefined || info.component?.file !== undefined)) sendCode(id, info);
          });
        }
      },
      flash: (target) => flashElement(target),
      // PRIVACY (D8 note 2026-09-27): a site the user enabled is not their own dev build, so
      // text that looks like personal data (emails, phone numbers...) is redacted as well.
      options: { redactPersonalData: !isLocalDevUrl(location.href) },
    });
    // Debug capture (D13): what fails on the page while recording, from the MAIN-world hook
    // (framework.content.ts), redacted like the page's text on an enabled site.
    const pageErrors = createPageErrors(window, { send: sendError, redactPersonalData: !isLocalDevUrl(location.href) });
    // Invalidated when a newer copy starts (see above). The page is released first: those
    // calls only touch the DOM, so they cannot fail in an orphaned copy.
    ctx.onInvalidated(() => {
      capture.stop();
      pageErrors.stop();
      notes.dispose();
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
        typed = isTyped(state);
        capture.start();
      } else {
        capture.stop();
        notes.close();
      }
      if (capturesErrors(state) && state.t0 !== undefined) pageErrors.start(state.t0);
      else pageErrors.stop();
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
      if (changes.undone) {
        notes.undone(changes.undone.id);
        undo.undone(changes.undone);
      }
      // The user removed this site (popup, or Chrome's "Site access" menu). Chrome keeps this
      // script running until the page reloads, so it releases the page itself (D8 note).
      if (changes.sites && !isCapturableUrl(location.href, changes.sites)) {
        capture.stop();
        pageErrors.stop();
        notes.dispose();
        pill.stop();
        disconnect();
      }
    });
    ctx.onInvalidated(disconnect);
  },
});
