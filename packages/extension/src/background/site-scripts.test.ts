import { describe, expect, it, vi } from "vitest";
import { LOCAL_HOST_MATCHES } from "../hosts";
import { SITE_FRAMEWORK_SCRIPT_ID, SITE_SCRIPT_ID, siteScripts, syncSiteScripts, type ScriptingAccess, type SiteScript } from "./site-scripts";

vi.mock("wxt/browser", () => ({ browser: {} }));
vi.mock("../state-store", () => ({ writeEnabledSites: async () => undefined }));

/** Chrome's permissions and registered scripts, in memory. */
function fakeChrome(granted: string[], registered: SiteScript[] = [], otherIds: string[] = []) {
  const scripts = new Map<string, SiteScript | null>(registered.map((script) => [script.id, script]));
  for (const id of otherIds) scripts.set(id, null);
  const access: ScriptingAccess = {
    grantedOrigins: async () => granted,
    registeredIds: async () => [...scripts.keys()],
    // Like Chrome: unknown ids and duplicate ids reject, and each call takes a moment.
    unregister: vi.fn(async (ids: string[]) => {
      await Promise.resolve();
      if (ids.some((id) => !scripts.has(id))) throw new Error("Nonexistent script ID");
      ids.forEach((id) => scripts.delete(id));
    }),
    register: vi.fn(async (list: SiteScript[]) => {
      await Promise.resolve();
      if (list.some((script) => scripts.has(script.id))) throw new Error("Duplicate script ID");
      list.forEach((script) => scripts.set(script.id, script));
    }),
  };
  return { access, scripts };
}

describe("siteScripts", () => {
  it("runs both built content scripts on the enabled sites, the framework one in the MAIN world", () => {
    const scripts = siteScripts(["*://example.com/*"]);
    expect(scripts).toEqual([
      expect.objectContaining({ id: SITE_SCRIPT_ID, js: ["content-scripts/content.js"], matches: ["*://example.com/*"], persistAcrossSessions: true }),
      expect.objectContaining({ id: SITE_FRAMEWORK_SCRIPT_ID, js: ["content-scripts/framework.js"], world: "MAIN", persistAcrossSessions: true }),
    ]);
    expect(scripts[0]?.world).toBeUndefined();
    expect(siteScripts([])).toEqual([]);
  });
});

describe("syncSiteScripts", () => {
  it("registers the enabled sites, leaving the local hosts to the manifest", async () => {
    const { access, scripts } = fakeChrome([...LOCAL_HOST_MATCHES, "*://example.com/*"]);
    expect(await syncSiteScripts(access)).toEqual(["*://example.com/*"]);
    expect(scripts.get(SITE_SCRIPT_ID)?.matches).toEqual(["*://example.com/*"]);
    expect(scripts.get(SITE_FRAMEWORK_SCRIPT_ID)?.matches).toEqual(["*://example.com/*"]);
  });

  it("replaces an older registration, and removes it when the last site is gone", async () => {
    const old = siteScripts(["*://a.org/*", "*://example.com/*"]);
    const chrome = fakeChrome(["*://example.com/*"], old, ["someone-else"]);
    await syncSiteScripts(chrome.access);
    expect(chrome.scripts.get(SITE_SCRIPT_ID)?.matches).toEqual(["*://example.com/*"]);

    const none = fakeChrome([...LOCAL_HOST_MATCHES], old, ["someone-else"]);
    expect(await syncSiteScripts(none.access)).toEqual([]);
    expect([...none.scripts.keys()]).toEqual(["someone-else"]);
    expect(none.access.register).not.toHaveBeenCalled();
  });

  it("runs back-to-back syncs one after the other, so the last grant list wins", async () => {
    // A site enabled, then removed right away: each sync sees the grants of its own event.
    const answers = [["*://a.org/*"], []];
    const { access, scripts } = fakeChrome([], siteScripts(["*://old.org/*"]));
    access.grantedOrigins = async () => answers.shift() ?? [];
    const first = syncSiteScripts(access);
    const second = syncSiteScripts(access);
    expect(await first).toEqual(["*://a.org/*"]);
    expect(await second).toEqual([]);
    expect(scripts.size).toBe(0);
  });
});
