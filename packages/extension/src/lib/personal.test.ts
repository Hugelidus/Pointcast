// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { describeElement } from "./describe";
import { redactPersonalText, redactPersonalUrl } from "./personal";

describe("redactPersonalText", () => {
  it.each([
    ["Contact ana.garcia+work@example.co.uk now", "Contact [redacted] now"],
    ["Call +34 612 345 678 today", "Call [redacted] today"],
    ["US: (555) 123-4567", "US: [redacted]"],
    ["Card 4111 1111 1111 1111 exp", "Card [redacted] exp"],
    ["Card 4111-1111-1111-1111", "Card [redacted]"],
    ["IBAN ES91 2100 0418 4502 0005 1332", "IBAN [redacted]"],
    ["IBAN DE89370400440532013000.", "IBAN [redacted]."],
    ["key example_api_key_0123456789abcdef here", "key [redacted] here"],
    ["jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", "jwt [redacted].[redacted].abc"],
  ])("redacts %j", (input, expected) => {
    expect(redactPersonalText(input)).toBe(expected);
  });

  it.each([
    "Orders on 2026-09-27 at 18:30:05",
    "Placed 2026-09-27 18:30",
    "Placed 27/09/2026 18:30:05",
    "Placed 27.09.2026 9:05",
    "Total: 1,234.56 EUR",
    "Quantity 12, page 3 of 40",
    "internationalization and accessibility",
    "Order #12345678",
  ])("keeps ordinary text: %j", (input) => {
    expect(redactPersonalText(input)).toBe(input);
  });
});

describe("redactPersonalUrl", () => {
  it("redacts emails, phones and IBANs in the path and query, escaped or not", () => {
    expect(redactPersonalUrl("https://crm.example.com/customers?email=bob%40example.com&phone=612345678")).toBe(
      "https://crm.example.com/customers?email=[redacted]&phone=[redacted]",
    );
    expect(redactPersonalUrl("https://shop.example.com/orders/ES9121000418450200051332")).toBe(
      "https://shop.example.com/orders/[redacted]",
    );
  });

  it("returns a URL with nothing personal unchanged, escapes included", () => {
    for (const url of ["https://example.com/search?q=caf%C3%A9%20bar&page=2", "https://example.com/100%", "https://example.com/2026/09/27/"]) {
      expect(redactPersonalUrl(url)).toBe(url);
    }
  });
});

describe("describeElement with redactPersonalData", () => {
  const doc = new JSDOM(
    `<body><main><ul><li aria-label="Row for bob@example.com"><a href="mailto:x">bob@example.com</a> · +44 20 7946 0958</li></ul></main></body>`,
    { url: "https://example.com/" },
  ).window.document;
  const li = doc.querySelector("li") as Element;

  it("redacts text, label, path, selector and html", () => {
    const info = describeElement(li, { redactPersonalData: true });
    expect(info.text).toBe("[redacted] · [redacted]");
    expect(info.label).toBe("Row for [redacted]");
    expect(info.path).toBe("main › ul › li«Row for [redacted]»");
    expect(info.selector).toBe('li[aria-label="Row for [redacted]"]');
    expect(info.selectorUnique).toBe(false); // no longer matches the page
    expect(info.html).not.toMatch(/bob@|7946/);
    expect(info.html).toContain("[redacted]");
  });

  it("is off by default: local apps keep every character", () => {
    const info = describeElement(li);
    expect(info.text).toBe("bob@example.com · +44 20 7946 0958");
    expect(info.selectorUnique).toBe(true);
  });
});
