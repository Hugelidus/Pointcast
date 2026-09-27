import { browser } from "wxt/browser";
import { enabledSitePatterns } from "../sites";
import { writeEnabledSites } from "../state-store";
import { createSerialQueue } from "./serial";

/**
 * Content scripts for the sites the user enabled (D8 note 2026-09-27).
 *
 * Manifest content scripts cannot follow a list that changes at run time, so enabled sites get
 * the same built files through chrome.scripting.registerContentScripts, persisted across browser
 * restarts. The granted host permissions are the source of truth (sites.ts): every sync
 * replaces the registration with one built from them, so a site removed in the popup or in
 * Chrome's own "Site access" menu stops being captured, and a missed event is repaired by the
 * next sync (install, update, or any grant or removal).
 */

/** The isolated-world script: capture, pill, flash (entrypoints/content.ts). */
export const SITE_SCRIPT_ID = "pointcast-sites";
/** The MAIN-world script that reads framework component info (entrypoints/framework.content.ts). */
export const SITE_FRAMEWORK_SCRIPT_ID = "pointcast-sites-framework";

/** What registerContentScripts takes, reduced to the fields used here. */
export interface SiteScript {
  id: string;
  matches: string[];
  js: string[];
  runAt: "document_start" | "document_end" | "document_idle";
  world?: "ISOLATED" | "MAIN";
  persistAcrossSessions: boolean;
}

/**
 * The registrations for `sites`, mirroring how the manifest runs the two scripts on local dev
 * hosts: top frame only (allFrames defaults to false), same files, same timing. The file names
 * are the ones WXT builds for entrypoints/content.ts and entrypoints/framework.content.ts.
 */
export function siteScripts(sites: readonly string[]): SiteScript[] {
  if (sites.length === 0) return [];
  const matches = [...sites];
  return [
    { id: SITE_SCRIPT_ID, matches, js: ["content-scripts/content.js"], runAt: "document_idle", persistAcrossSessions: true },
    {
      id: SITE_FRAMEWORK_SCRIPT_ID,
      matches,
      js: ["content-scripts/framework.js"],
      // Like the manifest entry: its listener must exist before the first gesture.
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
    },
  ];
}

/** The browser calls a sync needs; injected so the logic is unit-tested. */
export interface ScriptingAccess {
  grantedOrigins(): Promise<string[]>;
  registeredIds(): Promise<string[]>;
  unregister(ids: string[]): Promise<void>;
  register(scripts: SiteScript[]): Promise<void>;
}

/**
 * One sync at a time. Grant and removal events can fire back to back (a site enabled, then
 * removed); two interleaved syncs would each unregister the other's scripts, and the loser's
 * stale grant list could end up registered.
 */
const serially = createSerialQueue();

/**
 * Makes the registered scripts match the enabled sites, then tells open pages which sites are
 * enabled (SITES_KEY), so a page on a removed site stops capturing without a reload; returns
 * those sites. Unregister, then register: simpler than diffing, and updateContentScripts cannot
 * add a script that is missing.
 */
export function syncSiteScripts(access: ScriptingAccess): Promise<string[]> {
  return serially(async () => {
    const sites = enabledSitePatterns(await access.grantedOrigins());
    const ours = (await access.registeredIds()).filter((id) => id === SITE_SCRIPT_ID || id === SITE_FRAMEWORK_SCRIPT_ID);
    if (ours.length > 0) await access.unregister(ours);
    const scripts = siteScripts(sites);
    if (scripts.length > 0) await access.register(scripts);
    await writeEnabledSites(sites);
    return sites;
  });
}

const chromeScripting: ScriptingAccess = {
  async grantedOrigins() {
    return (await browser.permissions.getAll()).origins ?? [];
  },
  async registeredIds() {
    return (await browser.scripting.getRegisteredContentScripts()).map((script) => script.id);
  },
  async unregister(ids) {
    await browser.scripting.unregisterContentScripts({ ids });
  },
  async register(scripts) {
    await browser.scripting.registerContentScripts(scripts);
  },
};

/** The enabled sites Chrome reports now, for deciding which open tabs to attach. */
export async function enabledSites(): Promise<string[]> {
  return enabledSitePatterns(await chromeScripting.grantedOrigins());
}

/** syncSiteScripts against Chrome. Never rejects: a failed sync is logged and retried by the next one. */
export async function syncRegisteredSiteScripts(): Promise<void> {
  try {
    await syncSiteScripts(chromeScripting);
  } catch (error) {
    console.error("[pointcast] could not register the content scripts for enabled sites", error);
  }
}
