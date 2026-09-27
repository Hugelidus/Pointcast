import { describe, expect, it } from "vitest";
import { redactUrl } from "./url";

describe("redactUrl", () => {
  it("returns URLs without secrets unchanged, byte for byte", () => {
    for (const url of [
      "http://localhost:5500/index.html",
      "http://localhost:5500/spa.html?view=/reports",
      "http://app.localhost:5500/a%20b?q=hello+world#section",
      "../relative/page.html?page=2",
      // Readable slugs and short ids stay: they tell the agent which page it was.
      "http://localhost:3000/docs/getting-started-guide-2024",
      "http://localhost:3000/orders/1001/items/42",
      "http://localhost:3000/blog/2026-09-26-release-notes#install-v2",
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  it.each([
    // OAuth "state" is an anti-forgery secret too.
    ["http://localhost:3000/cb?code=abc&state=xyz", "http://localhost:3000/cb?code=REDACTED&state=REDACTED"],
    ["http://localhost:3000/magic?jwt=eyJhbGciOi.abc.def", "http://localhost:3000/magic?jwt=REDACTED"],
    // Token-shaped values are redacted whatever the parameter is called.
    ["http://localhost/verify?t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "http://localhost/verify?t=REDACTED"],
    // Tokens in the path, where no parameter name announces them (Django, Laravel, invites).
    ["http://localhost:8000/reset/MQ/c3k2ab-9f8e7d6c5b4a/", "http://localhost:8000/reset/MQ/REDACTED/"],
    ["http://localhost/reset-password/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "http://localhost/reset-password/REDACTED"],
    ["/invite/aZ3kP9qL2mN7xR4t", "/invite/REDACTED"],
    // A client-side route in the hash.
    ["http://localhost/app#/reset/c3k2ab-9f8e7d6c5b4a", "http://localhost/app#/reset/REDACTED"],
    ["http://localhost/?access_token=t1&api_key=k1&page=3", "http://localhost/?access_token=REDACTED&api_key=REDACTED&page=3"],
    ["http://localhost/?Password=p&SessionId=s&X-Amz-Signature=sig", "http://localhost/?Password=REDACTED&SessionId=REDACTED&X-Amz-Signature=REDACTED"],
    ["http://localhost/?otp=1&otp=2", "http://localhost/?otp=REDACTED&otp=REDACTED"],
    ["http://localhost/#access_token=t2&token_type=bearer", "http://localhost/#access_token=REDACTED&token_type=REDACTED"],
    ["/reset?token=abc#top", "/reset?token=REDACTED#top"],
    ["http://user:hunter2@localhost:8080/admin", "http://user:REDACTED@localhost:8080/admin"],
  ])("%s → %s", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});
