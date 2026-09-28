import { browser } from "wxt/browser";
import { IS_E2E } from "../../build-env";
import { copyFromPopup } from "../../clipboard";
import { isLocalDevUrl } from "../../hosts";
import { sendMessage, type TabCapture } from "../../messages";
import {
  formatElapsed,
  lastEventText,
  popupView,
  processingPanel,
  recordingTimeMs,
  resultView,
  shortcutHint,
  siteView,
  tabCaptureView,
  undoShortcutHint,
  undoView,
  type SiteStatus,
} from "../../popup/view";
import { languageName, WHISPER_LANGUAGES, type Settings } from "../../processing/settings";
import { IDLE_STATE, toggleCommand, type RecorderState } from "../../recorder-state";
import { TOGGLE_RECORDING_COMMAND, UNDO_EVENT_COMMAND } from "../../shortcut";
import { enabledSiteFor, enabledSitePatterns, patternHost, sitePattern } from "../../sites";
import {
  readEventCount,
  readLastEvent,
  readLastMarkdown,
  readSettings,
  readState,
  watchStore,
  writeSettings,
} from "../../state-store";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`popup: missing #${id}`);
  return element as T;
}

const statusEl = byId("status");
const elapsedEl = byId("elapsed");
const eventsEl = byId("events");
const toggleEl = byId<HTMLButtonElement>("toggle");
const messageEl = byId("message");
const tabStatusEl = byId("tab-status");
const lastEventEl = byId("last-event");
const shortcutEl = byId("shortcut");
const undoShortcutEl = byId("undo-shortcut");
const undoEl = byId<HTMLButtonElement>("undo");
const siteEl = byId("site");
const siteToggleEl = byId<HTMLButtonElement>("site-toggle");
const siteNoteEl = byId("site-note");
const progressEl = byId("progress");
const progressTextEl = byId("progress-text");
const progressFillEl = byId("progress-fill");
const progressDetailEl = byId("progress-detail");
const resultEl = byId("result");
const resultTimingEl = byId("result-timing");
const resultCodeEl = byId("result-code");
const copyAgainEl = byId<HTMLButtonElement>("copy-again");
const showFolderEl = byId<HTMLButtonElement>("show-folder");
const languageEl = byId<HTMLSelectElement>("language");
const keepAudioEl = byId<HTMLInputElement>("keep-audio");
const notifyEl = byId<HTMLInputElement>("notify");
const handoffEl = byId<HTMLInputElement>("handoff");

// The popup only mirrors storage; the service worker owns every transition. These copies
// are fine here: the popup is rebuilt from storage each time it opens.
let state: RecorderState = IDLE_STATE;
/** The recorder's summary of the last captured event. */
let lastEvent: string | undefined;
let commandPending = false;
/** Undefined until the service worker has checked the tab. */
let tabCapture: TabCapture | undefined;
/** Numbers the tab checks, so an older answer arriving late cannot replace a newer one. */
let lastCheck = 0;
/** The last session's Markdown, for "Copy again"; read again whenever the status changes. */
let lastMarkdown: string | undefined;
let eventCount = 0;
let undoPending = false;
/**
 * The active tab's remote site, when it is one pointcast can be enabled on; `pattern` is the
 * permission to request, or the granted one to remove.
 */
let site: (SiteStatus & { pattern: string }) | undefined;

function showMessage(text: string | null, isError = false): void {
  messageEl.hidden = text === null;
  messageEl.textContent = text ?? "";
  messageEl.classList.toggle("error", isError);
}

/** The parts that follow the clock: the recording time and the processing estimate. */
function renderClock(): void {
  const now = Date.now();
  elapsedEl.textContent = formatElapsed(recordingTimeMs(state, now));

  const panel = processingPanel(state, now);
  progressEl.hidden = panel === null;
  if (panel) {
    progressTextEl.textContent = panel.text;
    progressFillEl.style.width = `${Math.round(panel.fraction * 100)}%`;
    progressDetailEl.textContent = panel.detail;
  }
}

function renderResult(): void {
  const view = resultView(state, lastMarkdown !== undefined);
  resultEl.hidden =
    view === null || (!view.copyAgain && view.showInFolder === undefined && view.timing === null && view.code === null);
  if (!view) return;
  copyAgainEl.hidden = !view.copyAgain;
  showFolderEl.hidden = view.showInFolder === undefined;
  resultTimingEl.hidden = view.timing === null;
  resultTimingEl.textContent = view.timing ?? "";
  resultCodeEl.hidden = view.code === null;
  resultCodeEl.textContent = view.code ?? "";
}

function render(): void {
  const view = popupView(state);
  statusEl.textContent = view.statusText;
  statusEl.dataset["status"] = state.status;
  toggleEl.textContent = view.buttonText;
  toggleEl.className = view.buttonText === "Stop" ? "stop" : "record";
  toggleEl.disabled = !view.buttonEnabled || commandPending;
  showMessage(view.message?.text ?? null, view.message?.isError);
  const tab = tabCaptureView(tabCapture, state, site && !site.enabled ? site.host : undefined);
  tabStatusEl.textContent = tab.text;
  tabStatusEl.dataset["tone"] = tab.tone;
  const undo = undoView(state, eventCount);
  undoEl.hidden = !undo.visible;
  undoEl.disabled = !undo.enabled || undoPending;
  const siteSection = siteView(site);
  siteEl.hidden = siteSection === null;
  siteToggleEl.textContent = siteSection?.button ?? "";
  siteNoteEl.textContent = siteSection?.note ?? "";
  const last = lastEventText(state, lastEvent);
  lastEventEl.hidden = last === null;
  lastEventEl.textContent = last ?? "";
  renderClock();
  renderResult();
}

/**
 * Shows the Record/Stop shortcut as Chrome has it now: the user may have changed or removed it
 * in chrome://extensions/shortcuts, so the manifest's suggestion could be wrong.
 */
async function renderShortcut(): Promise<void> {
  let text: string | null = null;
  let undoText: string | null = null;
  try {
    const commands = await browser.commands.getAll();
    // Chrome reports an unbound command with a blank shortcut.
    const binding = (name: string) => {
      const command = commands.find((c) => c.name === name);
      return command === undefined ? undefined : (command.shortcut ?? "");
    };
    text = shortcutHint(binding(TOGGLE_RECORDING_COMMAND));
    undoText = undoShortcutHint(binding(UNDO_EVENT_COMMAND));
  } catch (error) {
    console.error("[pointcast] could not read the keyboard shortcuts", error);
  }
  shortcutEl.hidden = text === null;
  shortcutEl.textContent = text ?? "";
  undoShortcutEl.hidden = undoText === null;
  undoShortcutEl.textContent = undoText ?? "";
}

/**
 * The tab the popup reports on: the active tab of the window it was opened from. The e2e suite
 * opens popup.html in a tab of its own, where the active tab is the popup itself, so it names
 * the tab to check with ?tab=<id>. `url` is known for local dev hosts and enabled sites (host
 * permissions) and for the active tab when the user opened the popup from the toolbar (activeTab).
 */
async function targetTab(): Promise<{ id: number; url: string | undefined } | undefined> {
  const named = new URLSearchParams(location.search).get("tab");
  const tab =
    named !== null && /^\d+$/.test(named)
      ? await browser.tabs.get(Number(named))
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  return tab?.id === undefined ? undefined : { id: tab.id, url: tab.url };
}

/**
 * The active tab's remote site and whether it is enabled, from the granted permissions (the
 * only record of enabled sites, sites.ts). Undefined for local dev hosts and non-web pages.
 */
async function siteOf(url: string | undefined): Promise<(SiteStatus & { pattern: string }) | undefined> {
  const pattern = sitePattern(url);
  if (pattern === undefined) return undefined;
  const granted = enabledSiteFor(url, enabledSitePatterns((await browser.permissions.getAll()).origins));
  return { host: patternHost(pattern), enabled: granted !== undefined, pattern: granted ?? pattern };
}

/**
 * Shows whether the tab is captured. For a local tab or an enabled site, the service worker
 * attaches pointcast first (it injects the content script if the tab has none); any other tab
 * is answered here, without waking the service worker. Checked again whenever the recorder
 * status changes, e.g. after a start that attached every captured tab.
 */
async function checkTab(): Promise<void> {
  const check = ++lastCheck;
  let result: TabCapture;
  let tabSite: typeof site;
  try {
    const tab = await targetTab();
    tabSite = await siteOf(tab?.url);
    result =
      tab === undefined || !(isLocalDevUrl(tab.url) || tabSite?.enabled)
        ? { status: "not-local" }
        : ((await sendMessage({ to: "background", type: "attach-tab", tabId: tab.id })) ?? {
            status: "unavailable",
            error: "the extension did not answer",
          });
  } catch (error) {
    result = { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
  if (check !== lastCheck) return;
  tabCapture = result;
  site = tabSite;
  render();
}

/**
 * Enable: Chrome asks the user for this one host; on a yes, the service worker registers the
 * content scripts and attaches to the site's open tabs (permissions.onAdded in background.ts),
 * because Chrome's prompt may close this popup before the request resolves. Remove: the
 * permission goes, the service worker unregisters the scripts, and open pages of the site
 * release themselves (content.ts).
 */
siteToggleEl.addEventListener("click", async () => {
  if (!site) return;
  const origins = [site.pattern];
  try {
    if (site.enabled) await browser.permissions.remove({ origins });
    else if (!(await browser.permissions.request({ origins }))) return;
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), true);
    return;
  }
  await checkTab();
});

undoEl.addEventListener("click", async () => {
  undoPending = true;
  render();
  try {
    const result = await sendMessage({ to: "background", type: "undo" });
    undoPending = false;
    render();
    if (result) showMessage(result.ok ? `Undone: ${result.undone}` : result.error, !result.ok);
  } catch (error) {
    undoPending = false;
    render();
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
});

toggleEl.addEventListener("click", async () => {
  commandPending = true;
  render();
  const type = toggleCommand(state);
  try {
    const result = await sendMessage({ to: "background", type });
    commandPending = false;
    render();
    if (result && !result.ok) showMessage(result.error, true);
  } catch (error) {
    commandPending = false;
    render();
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
});

copyAgainEl.addEventListener("click", async () => {
  if (lastMarkdown === undefined) return;
  try {
    await copyFromPopup(lastMarkdown);
    copyAgainEl.textContent = "Copied ✓";
    setTimeout(() => (copyAgainEl.textContent = "Copy again"), 2000);
  } catch (error) {
    showMessage(`Could not copy: ${error instanceof Error ? error.message : String(error)}`, true);
  }
});

showFolderEl.addEventListener("click", async () => {
  const id = state.lastResult?.downloadId;
  if (id === undefined) return;
  // The e2e build must not open a file manager window on the machine running the tests.
  if (IS_E2E) await sendMessage({ to: "background", type: "e2e-record", record: { kind: "show-in-folder", downloadId: id } });
  else browser.downloads.show(id);
});

/** Settings are saved as soon as they change; the service worker reads them at the next Stop. */
function renderSettings(settings: Settings): void {
  const auto = new Option("Auto-detect", "auto");
  const languages = [...WHISPER_LANGUAGES]
    .map((code) => ({ code, name: languageName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  languageEl.replaceChildren(auto, ...languages.map(({ code, name }) => new Option(name, code)));
  languageEl.value = settings.language;
  keepAudioEl.checked = settings.keepAudio;
  notifyEl.checked = settings.notify;
  handoffEl.checked = settings.handoff;
}

function saveSettings(): void {
  void writeSettings({
    language: languageEl.value,
    keepAudio: keepAudioEl.checked,
    notify: notifyEl.checked,
    handoff: handoffEl.checked,
  });
}
for (const element of [languageEl, keepAudioEl, notifyEl, handoffEl]) element.addEventListener("change", saveSettings);

watchStore((changes) => {
  if (changes.state) {
    const statusChanged = changes.state.status !== state.status;
    state = changes.state;
    if (statusChanged) {
      void checkTab();
      void readLastMarkdown().then((markdown) => {
        lastMarkdown = markdown;
        render();
      });
    }
  }
  if (changes.eventCount !== undefined) {
    eventCount = changes.eventCount;
    eventsEl.textContent = String(eventCount);
  }
  if (changes.lastEvent !== undefined) lastEvent = changes.lastEvent ?? undefined;
  render();
});

const [initialState, initialCount, initialLastEvent, initialMarkdown, settings] = await Promise.all([
  readState(),
  readEventCount(),
  readLastEvent(),
  readLastMarkdown(),
  readSettings(),
]);
state = initialState;
lastEvent = initialLastEvent;
lastMarkdown = initialMarkdown;
eventCount = initialCount;
eventsEl.textContent = String(initialCount);
renderSettings(settings);
render();
void checkTab();
void renderShortcut();
setInterval(renderClock, 250);
