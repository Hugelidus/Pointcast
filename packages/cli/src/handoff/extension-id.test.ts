import { createHash } from "node:crypto";
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY, OFFICIAL_EXTENSION_IDS } from "@pointcast/core";
import { describe, expect, it } from "vitest";

/**
 * core has no node:crypto, so the key/id pair is checked here: swapping one without the other
 * would give every build an id the receiver refuses.
 */
describe("EXTENSION_ID", () => {
  it("is the id Chrome derives from EXTENSION_PUBLIC_KEY", () => {
    // Chrome: SHA-256 of the key's DER bytes, the first 32 hex digits mapped 0-f → a-p.
    const hex = createHash("sha256").update(Buffer.from(EXTENSION_PUBLIC_KEY, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((digit) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(digit, 16))).join("");
    expect(id).toBe(EXTENSION_ID);
    expect(OFFICIAL_EXTENSION_IDS).toContain(EXTENSION_ID);
  });
});
