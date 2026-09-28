import { browser } from "wxt/browser";
import type { InputMode } from "@pointcast/core";
import { IS_E2E } from "../../build-env";
import { copyFromPopup } from "../../clipboard";
import { openPermissionPage } from "../../background/permission-page";
import { isLocalDevUrl } from "../../hosts";
import { sendMessage, type TabCapture } from "../../messages";
import {
  firstRunNotice,
  formatElapsed,
  lastEventText,
  metaLine,
  modeView,
  pointingHint,
  popupView,
  processingPanel,
  recordingTimeMs,
  resultView,
  shortcutHint,
  siteView,
  splitLead,
  stageAnnouncement,
  tabCaptureView,
  undoneText,
  undoView,
  type Message,
  type MicrophonePermission,
  type SiteStatus,
} from "../../popup/view";
import { languageName, WHISPER_LANGUAGES, type Settings } from "../../processing/settings";
import { IDLE_STATE, type RecorderState } from "../../recorder-state";
import { TOGGLE_RECORDING_COMMAND, UNDO_EVENT_COMMAND } from "../../shortcut";
import { enabledSiteFor, enabledSitePatterns, patternHost, sitePattern } from "../../sites";
import {
  readEventCount,
  readLastEvent,
  readLastMarkdown,
  readSettings,
  readState,
  readStats,
  watchStore,
  writeSettings,
} from "../../state-store";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`popup: missing #${id}`);
  return element as T;
}

const statusEl = byId("status");
const firstRunEl = byId("first-run");
const firstRunTitleEl = byId("first-run-title");
const firstRunTextEl = byId("first-run-text");
const statsEl = byId("stats");
const elapsedEl = byId("elapsed");
const eventsEl = byId("events");
const metaEl = byId("meta");
const toggleEl = byId<HTMLButtonElement>("toggle");
const messageEl = byId("message");
const detailsEl = byId<HTMLDetailsElement>("details");
const detailsTextEl = byId("details-text");
const tabStatusEl = byId("tab-status");
const lastEventEl = byId("last-event");
const hintsEl = byId("hints");
const shortcutEl = byId("shortcut");
const undoEl = byId<HTMLButtonElement>("undo");
const siteEl = byId("site");
const siteToggleEl = byId<HTMLButtonElement>("site-toggle");
const siteNoteEl = byId("site-note");
const progressEl = byId("progress");
const progressTextEl = byId("progress-text");
const progressBarEl = byId("progress-bar");
const progressFillEl = byId("progress-fill");
const progressDetailEl = byId("progress-detail");
const resultEl = byId("result");
const resultRuleEl = byId("result-rule");
const whereEl = byId("where");
const whereLabelEl = byId("where-label");
const wherePathEl = byId("where-path");
const warningEl = byId("warning");
const warningLeadEl = byId("warning-lead");
const warningBodyEl = byId("warning-body");
const resultMetaEl = byId("result-meta");
const resultCodeEl = byId("result-code");
const actionsEl = byId("actions");
const copyAgainEl = byId<HTMLButtonElement>("copy-again");
const showFolderEl = byId<HTMLButtonElement>("show-folder");
const copyPathEl = byId<HTMLButtonElement>("copy-path");
const liveEl = byId("live");
const liveAlertEl = byId("live-alert");
const languageEl = byId<HTMLSelectElement>("language");
const keepAudioEl = byId<HTMLInputElement>("keep-audio");
const notifyEl = byId<HTMLInputElement>("notify");
const handoffEl = byId<HTMLInputElement>("handoff");
const captureErrorsEl = byId<HTMLInputElement>("capture-errors");
const modeEl = byId<HTMLFieldSetElement>("mode");
const modeInputs = [...modeEl.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
const pointingEl = byId("pointing");

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
 * The active tab's remote site, when it is one Pointcast can be enabled on; `pattern` is the
 * permission to request, or the granted one to remove.
 */
let site: (SiteStatus & { pattern: string }) | undefined;
/** The extension's microphone permission, followed live: granting it in the permission page flips the button. */
let microphone: MicrophonePermission;
/** Whether the speech model was ever loaded here (processing/stats.ts), for the first-run notice. */
let modelReady: boolean | undefined;
/** Settings.inputMode: what the next Record starts (D12). */
let inputMode: InputMode = "voice";

/** What the popup knows besides the state; typed mode needs no microphone (D12). */
function context() {
  return { microphone, offSite: site !== undefined && !site.enabled, inputMode };
}

function setMessage(message: Message | null): void {
  messageEl.hidden = message === null;
  messageEl.className = message ? `message ${message.tone}` : "message";
  if (message?.tone !== "error") {
    messageEl.textContent = message?.text ?? "";
    return;
  }
  // The first sentence says what failed; it is set in bold so the rest reads as the advice.
  const { lead, body } = splitLead(message.text);
  const leadEl = document.createElement("span");
  leadEl.className = "lead";
  leadEl.textContent = lead;
  const bodyEl = document.createElement("span");
  bodyEl.className = "body";
  bodyEl.textContent = body;
  messageEl.replaceChildren(leadEl, body === "" ? "" : " ", bodyEl);
}

/** A message from a button (Undo, a failed command or copy): shown and announced at once. */
function showMessage(message: Message): void {
  setMessage(message);
  announce(message.tone === "error" ? "button-alert" : "button", message.text);
  flushAnnouncements();
  // The same message after the next press (another Undo of the same element) is news again.
  announced.delete("button");
  announced.delete("button-alert");
}

/**
 * What screen readers hear, through the live regions that stay in the page (index.html). Each
 * source (the stage, the headline, the warning, an error…) is announced when its text changes,
 * never again on the re-renders in between, and the changes of one render go out as one sentence.
 * Until the first render is done nothing is written: what the popup shows on opening is read
 * with the page itself.
 */
const announced = new Map<string, string>();
let pendingPolite: string[] = [];
let pendingAlert: string[] = [];
let announcing = false;
function announce(source: string, text: string): void {
  if (announced.get(source) === text) return;
  announced.set(source, text);
  if (text === "") return;
  (source.endsWith("alert") ? pendingAlert : pendingPolite).push(text);
}
function flushAnnouncements(): void {
  if (announcing) {
    if (pendingPolite.length > 0) liveEl.textContent = pendingPolite.join(" ");
    if (pendingAlert.length > 0) liveAlertEl.textContent = pendingAlert.join(" ");
  }
  pendingPolite = [];
  pendingAlert = [];
}

/** Visible and enabled: a control that can hold the focus. */
function usable(element: HTMLElement): boolean {
  return element.isConnected && element.closest("[hidden]") === null && !(element as HTMLButtonElement).disabled;
}

/**
 * Keyboard users must not lose their place when the control they pressed disappears: Stop is
 * hidden while processing, then the result replaces the progress panel. The focus goes to the
 * progress panel meanwhile, then to Copy again, the next thing to do; otherwise to the main button.
 */
let focusOwed = false;
function keepFocus(before: Element | null): void {
  if (before instanceof HTMLElement && before !== document.body && !usable(before)) focusOwed = true;
  if (!focusOwed) return;
  const target = [copyAgainEl, toggleEl, progressEl].find(usable);
  if (!target) return;
  focusOwed = false;
  target.focus();
}

/** The parts that follow the clock: the recording time and the processing estimate. */
function renderClock(): void {
  const before = document.activeElement;
  const now = Date.now();
  elapsedEl.textContent = formatElapsed(recordingTimeMs(state, now));

  const panel = processingPanel(state, now);
  progressEl.hidden = panel === null;
  if (panel) {
    progressTextEl.textContent = panel.text;
    progressFillEl.style.width = `${Math.round((panel.fraction ?? 0) * 100)}%`;
    // Without a value the progressbar reads as "busy" rather than as a false 0 %.
    if (panel.fraction === null) progressBarEl.removeAttribute("aria-valuenow");
    else progressBarEl.setAttribute("aria-valuenow", String(Math.round(panel.fraction * 100)));
    progressDetailEl.hidden = panel.detail === "";
    progressDetailEl.textContent = panel.detail;
  }
  announce("stage", stageAnnouncement(state, now));
  flushAnnouncements();
  keepFocus(before);
}

function renderResult(): void {
  const view = resultView(state, lastMarkdown !== undefined);
  resultEl.hidden = view === null;
  resultRuleEl.hidden = view === null && popupView(state).message === null;
  const meta = metaLine(state, eventCount);
  // While processing, the line sits above the progress panel; after, inside the result.
  metaEl.hidden = view !== null || meta === null;
  metaEl.textContent = meta ?? "";
  if (!view) return;
  whereEl.hidden = view.where === null;
  whereLabelEl.textContent = view.where?.label ?? "";
  wherePathEl.textContent = view.where?.path ?? "";
  wherePathEl.title = view.where?.title ?? "";
  warningEl.hidden = view.warning === null;
  warningLeadEl.textContent = view.warning?.lead ?? "";
  warningBodyEl.textContent = view.warning?.body ?? "";
  announce("warning", view.warning ? `${view.warning.lead} ${view.warning.body}`.trim() : "");
  resultMetaEl.hidden = meta === null;
  resultMetaEl.textContent = meta ?? "";
  resultCodeEl.hidden = view.code === null;
  resultCodeEl.textContent = view.code ?? "";
  copyAgainEl.hidden = !view.copyAgain;
  showFolderEl.hidden = view.showInFolder === undefined;
  copyPathEl.hidden = view.copyPath === undefined;
  const visible = [copyAgainEl, showFolderEl, copyPathEl].filter((button) => !button.hidden).length;
  actionsEl.hidden = visible === 0;
  actionsEl.dataset["count"] = String(visible);
}

function render(): void {
  const before = document.activeElement;
  const view = popupView(state, context());
  statusEl.textContent = view.statusText;
  statusEl.dataset["status"] = state.status;

  const notice = firstRunNotice(state, microphone, modelReady, inputMode);
  firstRunEl.hidden = notice === null;
  firstRunTitleEl.textContent = notice?.title ?? "";
  firstRunTextEl.textContent = notice?.text ?? "";

  statsEl.hidden = !view.showStats;
  hintsEl.hidden = !view.showHints;
  const mode = modeView(state, inputMode);
  modeEl.hidden = !mode.visible;
  modeEl.disabled = !mode.enabled;
  for (const input of modeInputs) input.checked = input.value === mode.value;
  pointingEl.textContent = pointingHint(mode.value);

  toggleEl.textContent = view.button.text;
  toggleEl.className = view.button.kind;
  toggleEl.hidden = !view.button.visible;
  toggleEl.disabled = !view.button.enabled;
  // While a command is on its way the button stays focusable (aria-disabled, clicks ignored):
  // disabling it would drop a keyboard user's focus on every press.
  toggleEl.setAttribute("aria-disabled", String(commandPending));

  setMessage(view.message);
  detailsEl.hidden = view.details === null;
  if (detailsTextEl.textContent !== (view.details ?? "")) detailsTextEl.textContent = view.details ?? "";
  announce("alert", view.message?.tone === "error" ? view.message.text : "");
  announce("headline", view.message && view.message.tone !== "error" ? view.message.text : "");

  const tab = tabCaptureView(tabCapture, state, site && !site.enabled ? site.host : undefined);
  tabStatusEl.hidden = !view.showTab;
  tabStatusEl.textContent = tab.text;
  tabStatusEl.dataset["tone"] = tab.tone;

  const undo = undoView(state, eventCount);
  undoEl.hidden = !undo.visible;
  undoEl.disabled = !undo.enabled;
  undoEl.setAttribute("aria-disabled", String(undoPending));

  const siteSection = siteView(site, inputMode === "typed" ? undefined : microphone);
  siteEl.hidden = siteSection === null || !view.showTab;
  siteToggleEl.textContent = siteSection?.button ?? "";
  siteToggleEl.className = siteSection?.kind ?? "secondary";
  siteNoteEl.textContent = siteSection?.note ?? "";

  const last = lastEventText(state, lastEvent);
  lastEventEl.hidden = last === null;
  lastEventEl.textContent = last ?? "";
  renderResult();
  renderClock();
  keepFocus(before);
}

/**
 * Shows the shortcuts as Chrome has them now: the user may have changed or removed them in
 * chrome://extensions/shortcuts, so the manifest's suggestions could be wrong.
 */
async function renderShortcut(): Promise<void> {
  let parts: ReturnType<typeof shortcutHint> = null;
  try {
    const commands = await browser.commands.getAll();
    // Chrome reports an unbound command with a blank shortcut.
    const binding = (name: string) => {
      const command = commands.find((c) => c.name === name);
      return command === undefined ? undefined : (command.shortcut ?? "");
    };
    parts = shortcutHint(binding(TOGGLE_RECORDING_COMMAND), binding(UNDO_EVENT_COMMAND));
  } catch (error) {
    console.error("[pointcast] could not read the keyboard shortcuts", error);
  }
  shortcutEl.hidden = parts === null;
  shortcutEl.replaceChildren(
    ...(parts ?? []).map((part) => {
      if ("text" in part) return document.createTextNode(part.text);
      const key = document.createElement("kbd");
      key.textContent = part.key;
      return key;
    }),
  );
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
 * attaches Pointcast first (it injects the content script if the tab has none); any other tab
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
 * The microphone permission of the extension origin, which the offscreen recorder uses. Chrome
 * only asks for it from a visible extension page (the permission page), never from the popup.
 */
async function watchMicrophone(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    microphone = status.state;
    status.addEventListener("change", () => {
      microphone = status.state;
      render();
    });
  } catch {
    // Some browsers cannot query it: Record is offered, and a refused start opens the page.
    microphone = undefined;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    showMessage({ tone: "error", text: errorText(error) });
    return;
  }
  await checkTab();
});

undoEl.addEventListener("click", async () => {
  if (undoPending) return;
  undoPending = true;
  render();
  try {
    const result = await sendMessage({ to: "background", type: "undo" });
    undoPending = false;
    render();
    if (result) showMessage(result.ok ? { tone: "ok", text: undoneText(result.undone) } : { tone: "error", text: result.error });
  } catch (error) {
    undoPending = false;
    render();
    showMessage({ tone: "error", text: errorText(error) });
  }
});

toggleEl.addEventListener("click", async () => {
  if (commandPending) return;
  const action = popupView(state, context()).button.action;
  if (action === "allow-microphone") {
    // Opening the tab closes this popup; the permission page asks, then brings the user back to
    // the tab they were in, and the button here reads Record from the next time the popup opens.
    await openPermissionPage();
    return;
  }
  commandPending = true;
  render();
  try {
    const result = await sendMessage({ to: "background", type: action });
    commandPending = false;
    render();
    if (result && !result.ok) showMessage({ tone: "error", text: result.error });
  } catch (error) {
    commandPending = false;
    render();
    showMessage({ tone: "error", text: errorText(error) });
  }
});

/** "Copied ✓" on the button for a moment, then its label again. */
function confirmCopy(button: HTMLButtonElement, label: string): void {
  button.textContent = "Copied ✓";
  announce("copy", "Copied");
  flushAnnouncements();
  setTimeout(() => {
    button.textContent = label;
    announce("copy", "");
  }, 2000);
}

copyAgainEl.addEventListener("click", async () => {
  if (lastMarkdown === undefined) return;
  try {
    await copyFromPopup(lastMarkdown);
    confirmCopy(copyAgainEl, "Copy again");
  } catch (error) {
    showMessage({ tone: "error", text: `Could not copy: ${errorText(error)}` });
  }
});

copyPathEl.addEventListener("click", async () => {
  const path = state.lastResult?.handedOffTo;
  if (path === undefined) return;
  try {
    await copyFromPopup(path);
    confirmCopy(copyPathEl, "Copy path");
  } catch (error) {
    showMessage({ tone: "error", text: `Could not copy: ${errorText(error)}` });
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
  captureErrorsEl.checked = settings.captureErrors;
  inputMode = settings.inputMode;
}

function saveSettings(): void {
  void writeSettings({
    language: languageEl.value,
    keepAudio: keepAudioEl.checked,
    notify: notifyEl.checked,
    handoff: handoffEl.checked,
    inputMode,
    captureErrors: captureErrorsEl.checked,
  });
}
for (const element of [languageEl, keepAudioEl, notifyEl, handoffEl, captureErrorsEl]) element.addEventListener("change", saveSettings);
for (const input of modeInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    inputMode = input.value === "typed" ? "typed" : "voice";
    saveSettings();
    render();
  });
}

/** The model may have been downloaded by the run that just ended: the first-run notice then goes. */
async function refreshModelReady(): Promise<void> {
  try {
    modelReady = (await readStats()).modelReady;
  } catch {
    modelReady = undefined;
  }
}

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
      if (state.status === "idle") void refreshModelReady().then(render);
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
  watchMicrophone(),
  refreshModelReady(),
]);
state = initialState;
lastEvent = initialLastEvent;
lastMarkdown = initialMarkdown;
eventCount = initialCount;
eventsEl.textContent = String(initialCount);
renderSettings(settings);
render();
announcing = true;
void checkTab();
void renderShortcut();
setInterval(renderClock, 250);
