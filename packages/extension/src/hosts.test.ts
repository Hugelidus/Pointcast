import { describe, expect, it } from "vitest";
import { isLocalDevUrl, LOCAL_HOSTS } from "./hosts";

describe("isLocalDevUrl", () => {
  it("accepts every local dev host of D8, on any port, over http and https", () => {
    for (const url of [
      "http://localhost:5173/",
      "https://localhost/app",
      "http://app.localhost:3000/x?y=1",
      "http://127.0.0.1:8080/",
      "http://[::1]:5511/index.html",
      "http://myapp.test/",
      "https://api.myapp.test:8443/",
      "http://LOCALHOST:3000/",
    ]) {
      expect(isLocalDevUrl(url), url).toBe(true);
    }
  });

  it("rejects remote sites, look-alike hosts, other schemes and unknown URLs", () => {
    for (const url of [
      "https://example.com/",
      "http://localhost.example.com/",
      "http://mylocalhost/",
      "http://127.0.0.2/",
      "http://mytest/",
      "http://test.example/",
      "file:///C:/Users/me/index.html",
      "chrome://extensions/",
      "chrome-extension://abc/popup.html",
      "ftp://localhost/",
      "not a url",
      "",
      undefined,
    ]) {
      expect(isLocalDevUrl(url), String(url)).toBe(false);
    }
  });

  it("reads its hosts from the manifest patterns", () => {
    expect(LOCAL_HOSTS).toEqual(["localhost", "*.localhost", "127.0.0.1", "[::1]", "*.test"]);
  });
});
