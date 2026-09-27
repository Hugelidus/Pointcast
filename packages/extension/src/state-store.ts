import { browser } from "wxt/browser";
import { parseSettings, SETTINGS_KEY, type Settings } from "./processing/settings";
import { parseStats, STATS_KEY, type ProcessingStats } from "./processing/stats";
import {
  EVENT_COUNT_KEY,
  LAST_EVENT_KEY,
  parseLastEvent,
  parseState,
  parseUndone,
  SITES_KEY,
  STATE_KEY,
  UNDONE_KEY,
  type RecorderState,
  type UndoneEvent,
} from "./recorder-state";

/** chrome.storage.session: in memory, survives service worker restarts, cleared with the browser (D6). */
const area = browser.storage.session;

export async function readState(): Promise<RecorderState> {
  const stored = await area.get(STATE_KEY);
  return parseState(stored[STATE_KEY]);
}

/** Only the service worker writes the state; other contexts read it and follow onChanged. */
export async function writeState(state: RecorderState): Promise<void> {
  await area.set({ [STATE_KEY]: state });
}

export async function readEventCount(): Promise<number> {
  const stored = await area.get(EVENT_COUNT_KEY);
  const count = stored[EVENT_COUNT_KEY];
  return typeof count === "number" ? count : 0;
}

export async function writeEventCount(count: number): Promise<void> {
  await area.set({ [EVENT_COUNT_KEY]: count });
}

export async function readLastEvent(): Promise<string | undefined> {
  const stored = await area.get(LAST_EVENT_KEY);
  return parseLastEvent(stored[LAST_EVENT_KEY]);
}

/**
 * The count and the event that produced it, in one write: the popup never shows one without the
 * other. `lastEvent` is null when an Undo removed the only event.
 */
export async function writeCapturedEvent(count: number, lastEvent: string | null): Promise<void> {
  await area.set({ [EVENT_COUNT_KEY]: count, [LAST_EVENT_KEY]: lastEvent });
}

/** A new recording starts with nothing captured: no count, and no summary left from the previous one. */
export async function resetCapturedEvents(): Promise<void> {
  await area.set({ [EVENT_COUNT_KEY]: 0, [LAST_EVENT_KEY]: null });
}

/** Only the service worker writes it, after the recorder removed an event (Undo). */
export async function writeUndone(undone: UndoneEvent): Promise<void> {
  await area.set({ [UNDONE_KEY]: undone });
}

/** Only the service worker writes it, after syncing the enabled sites' content scripts. */
export async function writeEnabledSites(sites: string[]): Promise<void> {
  await area.set({ [SITES_KEY]: sites });
}

export interface StoredChanges {
  state?: RecorderState;
  /** Present when an Undo happened. */
  undone?: UndoneEvent;
  /** Present when the enabled sites changed. */
  sites?: string[];
  eventCount?: number;
  /** Present when it changed; null when it was cleared (a new recording started). */
  lastEvent?: string | null;
}

/** Calls `onChange` with whatever changed in the recorder keys; returns an unsubscribe function. */
export function watchStore(onChange: (changes: StoredChanges) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== "session") return;
    const result: StoredChanges = {};
    const state = changes[STATE_KEY];
    const count = changes[EVENT_COUNT_KEY];
    const lastEvent = changes[LAST_EVENT_KEY];
    const undone = parseUndone(changes[UNDONE_KEY]?.newValue);
    if (state) result.state = parseState(state.newValue);
    if (undone) result.undone = undone;
    const sites = changes[SITES_KEY];
    if (sites) result.sites = Array.isArray(sites.newValue) ? sites.newValue.filter((site) => typeof site === "string") : [];
    if (count) result.eventCount = typeof count.newValue === "number" ? count.newValue : 0;
    if (lastEvent) result.lastEvent = parseLastEvent(lastEvent.newValue) ?? null;
    if (state || count || lastEvent || undone || sites) onChange(result);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * The last session's Markdown, for the popup's "Copy again". Not in storage.session: content
 * scripts can read that whole area (background.ts opens it to them for the recorder state), and
 * a content script on an enabled remote site must never see the transcript of a local app. The
 * extension origin's Cache API is reachable from the service worker and the popup only. It
 * persists on disk, so background.ts clears it when the browser starts, like storage.session.
 */
const LAST_MARKDOWN_CACHE = "pointcast-last-session";
/** Cache keys must be http(s) URLs; nothing is ever fetched from this one. */
const LAST_MARKDOWN_URL = "https://pointcast.invalid/last-session.md";

/** Undefined when there is none, or when the cache cannot be read: the popup must still open. */
export async function readLastMarkdown(): Promise<string | undefined> {
  try {
    const response = await (await caches.open(LAST_MARKDOWN_CACHE)).match(LAST_MARKDOWN_URL);
    return response ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

export async function writeLastMarkdown(markdown: string): Promise<void> {
  const response = new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  await (await caches.open(LAST_MARKDOWN_CACHE)).put(LAST_MARKDOWN_URL, response);
}

export async function clearLastMarkdown(): Promise<void> {
  await caches.delete(LAST_MARKDOWN_CACHE);
}

/** chrome.storage.local: settings and what earlier runs taught must survive browser restarts. */
const persistent = browser.storage.local;

export async function readSettings(): Promise<Settings> {
  const stored = await persistent.get(SETTINGS_KEY);
  return parseSettings(stored[SETTINGS_KEY]);
}

/** Only the popup writes settings. */
export async function writeSettings(settings: Settings): Promise<void> {
  await persistent.set({ [SETTINGS_KEY]: settings });
}

export async function readStats(): Promise<ProcessingStats> {
  const stored = await persistent.get(STATS_KEY);
  return parseStats(stored[STATS_KEY]);
}

/** Only the service worker writes stats, once per processed session. */
export async function writeStats(stats: ProcessingStats): Promise<void> {
  await persistent.set({ [STATS_KEY]: stats });
}
