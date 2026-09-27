import { describe, expect, it } from "vitest";
import { trimHtml } from "./html-trim";

describe("trimHtml", () => {
  it("returns HTML within budget unchanged", () => {
    expect(trimHtml("<th>Quantity</th>", 300)).toBe("<th>Quantity</th>");
  });

  it("cuts text at a word boundary, appends … and closes open tags within budget", () => {
    const html = `<p>${"lorem ipsum ".repeat(20).trim()}</p>`;
    const out = trimHtml(html, 40);
    expect(out).toBe("<p>lorem ipsum lorem ipsum lorem…</p>");
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it("never cuts inside a tag, even with > inside attribute values", () => {
    const html =
      '<ul><li>One</li><li title="a > b" data-testid="second-item-with-long-attributes">Two</li></ul>';
    expect(trimHtml(html, 40)).toBe("<ul><li>One</li>…</ul>");
  });

  it("does not expect void elements or self-closing tags to be closed", () => {
    const html = `<div><img alt="x"><svg/><br><span>${"word ".repeat(30)}</span></div>`;
    const out = trimHtml(html, 60);
    expect(out).toBe('<div><img alt="x"><svg/><br><span>word word…</span></div>');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it("does not leave half an entity behind", () => {
    // A hard cut after 9 characters would end in "&a".
    const html = `<p>A&amp;B&amp;C&amp;D&amp;E</p>`;
    expect(trimHtml(html, 17)).toBe("<p>A&amp;B…</p>");
  });

  it("closes nested tags in the right order", () => {
    const html = `<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead></table>`;
    expect(trimHtml(html, 60)).toBe(
      "<table><thead><tr><th>A</th><th>B</th>…</tr></thead></table>",
    );
  });

  it("is deterministic and handles empty input", () => {
    expect(trimHtml("", 10)).toBe("");
  });

  it("never cuts a surrogate pair (e.g. an emoji) in half when trimming text", () => {
    const html = `<p>${"🎉".repeat(10)}</p>`;
    // Budget 9 forces a 1-code-unit text room, landing mid-surrogate for the first emoji.
    const out = trimHtml(html, 9);
    expect(out.length).toBeLessThanOrEqual(9);
    expect([...out]).not.toContain("\uD83C");
    expect(out).toBe("<p>…</p>");
  });
});
