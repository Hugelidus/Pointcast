import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTab, createTabAttacher, type TabAccess } from "./content-scripts";

// The Chrome-facing part of site-scripts.ts (and the storage it writes) is not needed here.
vi.mock("./site-scripts", () => ({ enabledSites: async () => [] }));

const LOCAL = { id: 7, url: "http://localhost:5173/orders" };
const NO_RECEIVER = new Error("Could not establish connection. Receiving end does not exist.");

/** A tab whose content script is alive or not; injecting makes it alive unless `injectError` is set. */
function fakeTab(options: { alive?: boolean; injectError?: Error; hang?: boolean } = {}) {
  let alive = options.alive ?? false;
  const access = {
    ping: vi.fn<TabAccess["ping"]>(async () => {
      if (options.hang) return new Promise<void>(() => undefined);
      if (!alive) throw NO_RECEIVER;
    }),
    inject: vi.fn<TabAccess["inject"]>(async () => {
      await Promise.resolve();
      if (options.injectError) throw options.injectError;
      alive = true;
    }),
  };
  return access;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("attachTab", () => {
  it("leaves tabs that are not on a local dev host alone", async () => {
    const access = fakeTab();
    for (const url of [undefined, "https://example.com/", "file:///C:/app/index.html", "chrome://newtab/"]) {
      expect(await attachTab({ id: 1, url }, access)).toEqual({ status: "not-local" });
    }
    expect(access.ping).not.toHaveBeenCalled();
    expect(access.inject).not.toHaveBeenCalled();
  });

  it("attaches to a site the user enabled, and only to that host", async () => {
    const access = fakeTab();
    const sites = ["*://example.com/*"];
    expect(await attachTab({ id: 3, url: "https://example.com/admin" }, access, sites)).toEqual({ status: "attached" });
    expect(await attachTab({ id: 4, url: "https://www.example.com/" }, access, sites)).toEqual({ status: "not-local" });
    expect(access.inject).toHaveBeenCalledTimes(1);
    expect(access.inject).toHaveBeenCalledWith(3);
  });

  it("does not inject a second copy where a live content script answers", async () => {
    const access = fakeTab({ alive: true });
    expect(await attachTab(LOCAL, access)).toEqual({ status: "attached" });
    expect(access.inject).not.toHaveBeenCalled();
  });

  it("injects where nobody answers (never injected, or orphaned by a reload), then checks it answers", async () => {
    const access = fakeTab({ alive: false });
    expect(await attachTab(LOCAL, access)).toEqual({ status: "attached" });
    expect(access.inject).toHaveBeenCalledWith(7);
    expect(access.ping).toHaveBeenCalledTimes(2);
  });

  it("reports a tab that cannot be scripted, without throwing", async () => {
    const access = fakeTab({ injectError: new Error("Frame with ID 0 is showing error page") });
    expect(await attachTab(LOCAL, access)).toEqual({
      status: "unavailable",
      error: "Frame with ID 0 is showing error page",
    });
  });

  it("reports an injected copy that still does not answer", async () => {
    const access = fakeTab();
    access.inject.mockResolvedValue(undefined);
    expect(await attachTab(LOCAL, access)).toEqual({ status: "unavailable", error: NO_RECEIVER.message });
  });

  it("gives up on a tab that never answers (e.g. paused in the debugger)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const result = attachTab(LOCAL, fakeTab({ hang: true }), [], 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ status: "unavailable", error: "The tab did not answer within 2 s." });
  });
});

describe("createTabAttacher", () => {
  it("shares one attach between callers that ask for the same tab at once", async () => {
    const access = fakeTab();
    const attacher = createTabAttacher(access);
    const [first, second] = await Promise.all([attacher.attach(LOCAL), attacher.attach(LOCAL)]);
    expect(first).toEqual({ status: "attached" });
    expect(second).toBe(first);
    expect(access.inject).toHaveBeenCalledTimes(1);
  });

  it("checks again on a later call", async () => {
    const access = fakeTab();
    const attacher = createTabAttacher(access);
    await attacher.attach(LOCAL);
    await attacher.attach(LOCAL);
    expect(access.ping).toHaveBeenCalledTimes(3);
    expect(access.inject).toHaveBeenCalledTimes(1);
  });
});
