import { beforeEach, describe, expect, it, vi } from "vitest";

const tabs = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { getURL: (path: string) => `chrome-extension://id${path}` }, tabs },
}));

const { openPermissionPage, parseFromTab, permissionPageUrl } = await import("./permission-page");

beforeEach(() => {
  tabs.query.mockReset();
  tabs.create.mockReset();
});

describe("permissionPageUrl / parseFromTab", () => {
  it("carries the tab the user was in, and reads it back", () => {
    expect(permissionPageUrl()).toBe("chrome-extension://id/permission.html");
    expect(permissionPageUrl(42)).toBe("chrome-extension://id/permission.html?from=42");
    expect(parseFromTab("?from=42")).toBe(42);
  });

  it("ignores anything that is not a tab id", () => {
    expect(parseFromTab("")).toBeUndefined();
    expect(parseFromTab("?from=")).toBeUndefined();
    expect(parseFromTab("?from=-1")).toBeUndefined();
    expect(parseFromTab("?from=4x")).toBeUndefined();
  });
});

describe("openPermissionPage", () => {
  it("opens the page for the active tab", async () => {
    tabs.query.mockResolvedValue([{ id: 7 }]);
    await openPermissionPage();
    expect(tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://id/permission.html?from=7" });
  });

  it("still opens it when the active tab cannot be read, and never rejects", async () => {
    tabs.query.mockRejectedValue(new Error("no window"));
    await openPermissionPage();
    expect(tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://id/permission.html" });

    tabs.create.mockRejectedValue(new Error("no window"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(openPermissionPage()).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});
