// @vitest-environment jsdom
import { UI_ATTRIBUTE } from "@pointcast/core";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DESCRIBE_OPTIONS } from "./options";
import { REDACTED_CONTENT, isSensitive, sanitizeHtml } from "./sanitize";

const options = DEFAULT_DESCRIBE_OPTIONS;

function el(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Element;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isSensitive", () => {
  it.each([
    '<input type="password">',
    '<input type="PASSWORD">',
    '<input autocomplete="current-password">',
    '<input autocomplete="new-password">',
    '<input autocomplete="one-time-code">',
    '<input autocomplete="cc-number">',
    '<input autocomplete="section-billing cc-exp">',
    '<input data-sensitive>',
  ])("%s is sensitive", (html) => {
    expect(isSensitive(el(html), options)).toBe(true);
  });

  it("propagates the marker attribute to the whole subtree", () => {
    const root = el('<div data-sensitive><p><span id="deep">secret</span></p></div>');
    expect(isSensitive(root.querySelector("#deep") as Element, options)).toBe(true);
  });

  it("honours a custom marker attribute", () => {
    const root = el('<div data-private><span>x</span></div>');
    expect(isSensitive(root.querySelector("span") as Element, { sensitiveAttribute: "data-private" })).toBe(true);
    expect(isSensitive(root.querySelector("span") as Element, options)).toBe(false);
  });

  it.each(['<input type="text">', '<input autocomplete="email">', "<p>hello</p>"])("%s is not sensitive", (html) => {
    expect(isSensitive(el(html), options)).toBe(false);
  });
});

describe("sanitizeHtml", () => {
  it("keeps only allowlisted attributes", () => {
    const html = sanitizeHtml(
      el(
        '<button id="go" type="button" style="color:red" onclick="steal()" data-v-7ba5bd90 _ngcontent-abc-c12 ' +
          'data-custom="x" aria-label="Go" aria-valuenow="42" title="t" data-testid="go" data-source="src/A.tsx:3">Go</button>',
      ),
      options,
    );
    expect(html).toBe(
      '<button id="go" type="button" aria-label="Go" title="t" data-testid="go" data-source="src/A.tsx:3">Go</button>',
    );
  });

  it("drops noise classes, keeps human and CSS-module classes, and drops class when all noise", () => {
    expect(sanitizeHtml(el('<div class="toolbar Toolbar_toolbar__a8Kd2 flex gap-2 css-1a2b3c">x</div>'), options)).toBe(
      '<div class="toolbar Toolbar_toolbar__a8Kd2">x</div>',
    );
    expect(sanitizeHtml(el('<div class="flex p-4 sc-bdVaJa kUgNyR">x</div>'), options)).toBe("<div>x</div>");
  });

  it("never outputs form values: value attributes, textarea content, selected/checked state", () => {
    const root = el(
      '<form><input name="a" value="typed-secret" checked><textarea name="b">textarea-secret</textarea>' +
        '<select name="c"><option value="1" selected>option-secret</option></select></form>',
    );
    (root.querySelector("textarea") as HTMLTextAreaElement).value = "typed-into-textarea";
    const html = sanitizeHtml(root, options) + sanitizeHtml(root.querySelector("textarea") as Element, options);
    expect(html).not.toMatch(/secret|typed|value=|checked|selected/);
    expect(html).toBe('<form><input name="a"><textarea name="b"></textarea><select name="c"></select></form><textarea name="b"></textarea>');
  });

  it("redacts the content of sensitive elements and of sensitive children", () => {
    const root = el('<div><p>public</p><div class="note" data-sensitive>hidden <b>words</b></div></div>');
    expect(sanitizeHtml(root, options)).toBe(`<div><p>public</p><div class="note">${REDACTED_CONTENT}</div></div>`);
    expect(sanitizeHtml(root.querySelector("b") as Element, options)).toBe(`<b>${REDACTED_CONTENT}</b>`);
  });

  // PRIVACY ATTACK (D8): redacting a sensitive element's *content* is not enough. Real apps
  // mirror a field's current value into title/aria-label/placeholder/alt (masked-value
  // tooltips, accessible names for custom widgets), and openTag used to copy every allowlisted
  // attribute verbatim regardless of sensitivity, so the value walked straight out through the
  // open tag of an element whose content was otherwise correctly redacted.
  it("never leaks a sensitive element's value through its own title/aria-label/placeholder/alt", () => {
    const root = el(
      '<input type="password" id="pw" title="CANARY-7391" aria-label="CANARY-7391" placeholder="CANARY-7391" alt="CANARY-7391">',
    );
    expect(sanitizeHtml(root, options)).not.toContain("CANARY-7391");
    expect(sanitizeHtml(root, options)).toBe('<input type="password" id="pw">');
  });

  it("scrubs the same attributes on a sensitive *child* of a described container", () => {
    const root = el(
      '<div><p>public</p><input type="text" autocomplete="cc-number" title="CANARY-7391" aria-label="CANARY-7391"></div>',
    );
    expect(sanitizeHtml(root, options)).not.toContain("CANARY-7391");
  });

  it("scrubs the attributes of an element made sensitive only by a data-sensitive ancestor", () => {
    const root = el('<div data-sensitive><span title="CANARY-7391" aria-label="CANARY-7391">x</span></div>');
    expect(sanitizeHtml(root.querySelector("span") as Element, options)).not.toContain("CANARY-7391");
  });

  it("still keeps title/aria-label on a non-sensitive element (no over-redaction)", () => {
    expect(sanitizeHtml(el('<button title="Export as CSV" aria-label="Export">Go</button>'), options)).toBe(
      '<button title="Export as CSV" aria-label="Export">Go</button>',
    );
  });

  it("trims structurally: direct children only, at most 5, texts of 60 chars, svg collapsed", () => {
    const items = Array.from({ length: 8 }, (_, i) => `<li><a href="/item/${i}"><span>Item ${i}</span></a></li>`).join("");
    expect(sanitizeHtml(el(`<ul>${items}</ul>`), options)).toBe(
      "<ul><li>Item 0</li><li>Item 1</li><li>Item 2</li><li>Item 3</li><li>Item 4</li>…(+3)</ul>",
    );
    const long = "word ".repeat(30);
    expect(sanitizeHtml(el(`<p>${long}</p>`), options)).toMatch(/^<p>(word ){11}word…<\/p>$/);
    expect(sanitizeHtml(el('<button><svg viewBox="0 0 24 24"><path d="M1 1"/></svg> Export</button>'), options)).toBe(
      "<button><svg/> Export</button>",
    );
  });

  it("leaves pointcast's own UI (REC badge, highlight flash) out of a container's HTML and text", () => {
    const container = el(`<div id="app"><p>Hello</p><div ${UI_ATTRIBUTE}="indicator">REC</div><div ${UI_ATTRIBUTE}="flash"></div></div>`);
    expect(sanitizeHtml(container, options)).toBe('<div id="app"><p>Hello</p></div>');
  });

  it("stays within the budget and well-formed by dropping children, never cutting mid-tag", () => {
    const children = Array.from({ length: 5 }, (_, i) => `<p title="${"t".repeat(100)}">child ${i}</p>`).join("");
    const html = sanitizeHtml(el(`<div id="big">${children}</div>`), { ...options, htmlBudget: 400 });
    expect(html.length).toBeLessThanOrEqual(400);
    expect(html).toMatch(/^<div id="big">(<p title="t+">child \d<\/p>)+…\(\+\d\)<\/div>$/);
  });

  // Further privacy-attack vectors (D8), verifying existing protections rather than fixing new
  // bugs: each of these should already be safe, and stays safe after the fixes above.
  it("never leaks a value set only via the DOM property, not the attribute", () => {
    const input = el('<input type="text" id="x" value="attr-secret">') as HTMLInputElement;
    input.value = "property-secret"; // overwrites the reflected attribute value in the browser too
    expect(sanitizeHtml(input, options)).toBe('<input type="text" id="x">');
  });

  it("never reveals which <option> is selected", () => {
    const html = sanitizeHtml(
      el('<select name="plan"><option value="a">Free</option><option value="b" selected>Pro-secret</option></select>'),
      options,
    );
    expect(html).toBe('<select name="plan"></select>');
  });

  it("drops a hidden input's value like any other input", () => {
    expect(sanitizeHtml(el('<input type="hidden" name="csrf" value="hidden-secret">'), options)).toBe(
      '<input type="hidden" name="csrf">',
    );
  });

  it("treats aria-valuetext like the other aria-value* state attributes", () => {
    expect(sanitizeHtml(el('<div role="slider" aria-valuetext="$4,321.00" aria-label="Amount">x</div>'), options)).toBe(
      '<div role="slider" aria-label="Amount">x</div>',
    );
  });

  it("redacts a very long secret split across many text nodes inside a sensitive element", () => {
    const digits = "4111222233334444".split("").map((d) => `<span>${d}</span>`).join("");
    const html = sanitizeHtml(el(`<div data-sensitive>${digits}</div>`), options);
    expect(html).toBe(`<div>${REDACTED_CONTENT}</div>`);
    expect(html).not.toMatch(/\d/);
  });

  it("never surfaces text hidden with the `hidden` attribute", () => {
    expect(sanitizeHtml(el('<div>public <span hidden>off-screen-secret</span></div>'), options)).toBe(
      "<div>public <span></span></div>",
    );
  });

  it("redacts secret query parameters in href", () => {
    expect(sanitizeHtml(el('<a href="/reset?token=abc123&page=2">Reset</a>'), options)).toBe(
      '<a href="/reset?token=REDACTED&amp;page=2">Reset</a>',
    );
  });

  it("escapes text and attribute values", () => {
    expect(sanitizeHtml(el('<p title="a &quot;b&quot;">1 &lt; 2 &amp; 3</p>'), options)).toBe(
      '<p title="a &quot;b&quot;">1 &lt; 2 &amp; 3</p>',
    );
  });
});
