import { describe, expect, it } from "vitest";
import { LOCAL_HOST_MATCHES } from "./hosts";
import { enabledSiteFor, enabledSitePatterns, isCapturableUrl, OPTIONAL_SITE_MATCHES, patternHost, sitePattern } from "./sites";

describe("sitePattern", () => {
  it("asks for one host, both schemes, any port", () => {
    expect(sitePattern("https://app.example.com:8443/orders?id=1")).toBe("*://app.example.com/*");
    expect(sitePattern("http://example.com/")).toBe("*://example.com/*");
  });

  it("asks for a pattern the manifest declares, or Chrome refuses the request", () => {
    // Chrome's rule: ONE declared optional pattern must contain the requested one. The "*"
    // scheme means http and https, so "*://host/*" fits in "*://*/*" but not in "http://*/*".
    const contains = (declared: string, requested: string): boolean => {
      const [ds, dh] = /^([^:]+):\/\/([^/]+)\//.exec(declared)?.slice(1) ?? [];
      const [rs, rh] = /^([^:]+):\/\/([^/]+)\//.exec(requested)?.slice(1) ?? [];
      return (ds === rs || ds === "*") && (dh === "*" || dh === rh);
    };
    for (const url of ["https://app.example.com:8443/orders", "http://staging.internal/", "http://10.0.0.5:3000/"]) {
      const pattern = sitePattern(url) ?? "";
      expect(OPTIONAL_SITE_MATCHES.some((declared) => contains(declared, pattern)), pattern).toBe(true);
    }
    // The manifest before the fix: each scheme declared on its own, so the request was refused.
    expect(["http://*/*", "https://*/*"].some((declared) => contains(declared, "*://example.com/*"))).toBe(false);
  });

  it("offers nothing for local dev hosts (always on) or pages that cannot be enabled", () => {
    for (const url of [
      undefined,
      "http://localhost:5173/",
      "http://myapp.test/",
      "file:///C:/app/index.html",
      "chrome://extensions/",
      "chrome-extension://abc/popup.html",
      "https://chromewebstore.google.com/detail/x",
      "not a url",
    ]) {
      expect(sitePattern(url), String(url)).toBeUndefined();
    }
  });
});

describe("enabled sites", () => {
  it("are the granted origins minus the manifest's local hosts", () => {
    const granted = [...LOCAL_HOST_MATCHES, "*://example.com/*", "*://a.org/*", "*://example.com/*"];
    expect(enabledSitePatterns(granted)).toEqual(["*://a.org/*", "*://example.com/*"]);
    expect(enabledSitePatterns(undefined)).toEqual([]);
  });

  it("never include a wildcard grant from Chrome's own Site access menu", () => {
    const granted = ["<all_urls>", "*://*/*", "https://*/*", "*://*.example.com/*", "https://shop.example.com/*"];
    expect(enabledSitePatterns(granted)).toEqual(["https://shop.example.com/*"]);
  });

  it("cover their exact host only, also when Chrome reports the grant per scheme", () => {
    const sites = ["https://example.com/*"];
    expect(enabledSiteFor("https://example.com/a", sites)).toBe("https://example.com/*");
    expect(enabledSiteFor("https://www.example.com/", sites)).toBeUndefined();
    expect(enabledSiteFor("https://example.org/", sites)).toBeUndefined();
    expect(patternHost("*://example.com/*")).toBe("example.com");
  });

  it("make a page capturable, next to local dev hosts", () => {
    expect(isCapturableUrl("http://localhost:3000/", [])).toBe(true);
    expect(isCapturableUrl("https://example.com/", [])).toBe(false);
    expect(isCapturableUrl("https://example.com/", ["*://example.com/*"])).toBe(true);
  });
});
