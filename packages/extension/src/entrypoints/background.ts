import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  abandonOverdueProcessing,
  finishProcessing,
  finishSessionIfSaved,
  PROCESSING_ALARM,
  recordEventCount,
  recordProcessingProgress,
  recoverInterruptedTransition,
  startRecording,
  stopRecording,
  toggleRecording,
  undoLastEvent,
} from "../background/commands";
import { attachToOpenTabs, attachToTab } from "../background/content-scripts";
import { createSerialQueue } from "../background/serial";
import { createShortcutHandler } from "../background/shortcut";
import { syncRegisteredSiteScripts } from "../background/site-scripts";
import { appendE2eRecord } from "../background/e2e-records";
import { listenFor } from "../messages";
import { TOGGLE_RECORDING_COMMAND, UNDO_EVENT_COMMAND } from "../shortcut";
import { clearLastMarkdown, readState } from "../state-store";

export default defineBackground(() => {
  // Every listener is registered synchronously at startup: when Chrome wakes a stopped
  // service worker for an event, only listeners added in the first turn receive it (D6).

  // Content scripts cannot read chrome.storage.session by default. They need the recorder
  // status (not secret) to show the REC indicator and follow changes without polling. The access
  // covers the whole area, so nothing secret goes there: the last Markdown lives in the Cache API.
  void browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

  // Handlers that change the recorder state run one at a time (serial.ts). The repair of a state
  // left busy by a previous, stopped instance goes first, before anything else reads it.
  // `recovered` belongs to this instance only; it is not session state (D6).
  const serially = createSerialQueue();
  const recovered = serially(recoverInterruptedTransition).catch((error: unknown) => {
    console.error("[pointcast] could not recover the recorder state", error);
  });

  listenFor("background", async (message) => {
    switch (message.type) {
      case "start":
        return serially(startRecording);
      case "stop":
        return serially(stopRecording);
      case "undo":
        return serially(undoLastEvent);
      case "get-state":
        // Read-only, so not queued behind a long stop, but never before the repair.
        await recovered;
        return readState();
      case "event-count":
        await recovered;
        await recordEventCount(message.count, message.lastEvent);
        return null;
      case "attach-tab":
        await recovered;
        return attachToTab(message.tabId);
      case "processing-progress":
        await serially(() => recordProcessingProgress(message.sessionId, message.progress));
        return null;
      case "processing-done":
        return serially(() => finishProcessing(message.sessionId, message.result));
      case "e2e-record":
        await serially(() => appendE2eRecord(message.record));
        return null;
    }
  });

  // The Record/Stop and Undo keyboard shortcuts (chrome://extensions/shortcuts). Chrome wakes a
  // stopped worker for them, so they must be registered here, in the first turn, like the
  // listeners above.
  const onShortcut = createShortcutHandler({
    [TOGGLE_RECORDING_COMMAND]: () => serially(toggleRecording),
    [UNDO_EVENT_COMMAND]: () => serially(undoLastEvent),
  });
  browser.commands.onCommand.addListener((command) => {
    void onShortcut(command);
  });

  // Install, update and reload (including every `wxt dev` rebuild): pages that were already open
  // have no live content script, because Chrome injects manifest scripts only into later page
  // loads. Attach them now, so they are captured without a reload (D6, note 2026-09-26).
  // The registered scripts of enabled sites are re-synced too (background/site-scripts.ts), in
  // case an update dropped them.
  browser.runtime.onInstalled.addListener(() => {
    void syncRegisteredSiteScripts().then(attachToOpenTabs);
    void clearLastMarkdown().catch(() => undefined);
  });

  // The last Markdown is kept on disk (state-store.ts) but, like storage.session, must not
  // outlive the browser session or the extension version that made it.
  browser.runtime.onStartup.addListener(() => {
    void clearLastMarkdown().catch(() => undefined);
  });

  // A site was enabled from the popup (or disabled there or in Chrome's "Site access" menu):
  // register the content scripts for the new list, then attach to its open tabs so the page the
  // user is on is captured without a reload. Syncs run one at a time (site-scripts.ts). Handled here rather than in the popup, because
  // Chrome's permission prompt may close the popup before its request resolves (D8 note).
  const onSitesChanged = () => void syncRegisteredSiteScripts().then(attachToOpenTabs);
  browser.permissions.onAdded.addListener(onSitesChanged);
  browser.permissions.onRemoved.addListener(onSitesChanged);

  browser.downloads.onChanged.addListener((delta) => {
    if (delta.state) void serially(finishSessionIfSaved);
  });

  // The processing timeout (commands.ts PROCESSING_ALARM): alarms wake a stopped worker.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PROCESSING_ALARM) void serially(abandonOverdueProcessing);
  });
});
