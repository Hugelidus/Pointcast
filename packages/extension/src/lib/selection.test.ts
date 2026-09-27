// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DESCRIBE_OPTIONS } from "./options";
import { readRange } from "./selection";

const options = DEFAULT_DESCRIBE_OPTIONS;

function fixture(html: string): void {
  document.body.innerHTML = html;
}

function selectAcross(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
}

function textNode(el: Element): Text {
  const node = Array.from(el.childNodes).find((n) => n.nodeType === 3);
  if (node === undefined) throw new Error("no text node");
  return node as Text;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("readRange privacy (D8)", () => {
  // PRIVACY ATTACK: a drag that starts in ordinary text and ends inside (or after) a sensitive
  // field must not leak the part of the selection that touches the field, or the field's value —
  // touchesSensitive() finds the field even though it is not the range's own boundary container.
  it("blanks a selection that starts in normal text and ends inside a sensitive input", () => {
    fixture('<p id="p">Card ending in <input type="text" autocomplete="cc-number" value="4111"></p>');
    const p = document.getElementById("p") as Element;
    const range = selectAcross(textNode(p), 0, p, p.childNodes.length);
    const reading = readRange(range, options);
    expect(reading.sensitive).toBe(true);
    expect(reading.text).toBe("");
  });

  // PRIVACY ATTACK: the marker can sit several levels above the selection's own container, not
  // just on an element the range directly crosses.
  it("blanks a selection whose container sits inside a data-sensitive ancestor several levels up", () => {
    fixture(
      '<div data-sensitive><section><article><p id="p">one two three</p></article></section></div>',
    );
    const p = document.getElementById("p") as Element;
    const range = selectAcross(textNode(p), 0, textNode(p), 7);
    const reading = readRange(range, options);
    expect(reading.sensitive).toBe(true);
    expect(reading.text).toBe("");
  });

  it("still reads ordinary text normally (no over-redaction)", () => {
    fixture('<p id="p">hello world</p>');
    const p = document.getElementById("p") as Element;
    const range = selectAcross(textNode(p), 0, textNode(p), 5);
    expect(readRange(range, options)).toMatchObject({ text: "hello", sensitive: false });
  });

  // PRIVACY ATTACK: dragging inside a textarea must not surface what was typed (D8), even though
  // Selection.toString() would happily return it — readRange walks text nodes instead and must
  // treat the textarea's own text content as a form value, not selectable page text.
  it("never returns a textarea's own text as selected text", () => {
    fixture('<textarea id="t">typed-secret</textarea>');
    const textarea = document.getElementById("t") as HTMLTextAreaElement;
    const range = selectAcross(textNode(textarea), 0, textNode(textarea), 6);
    expect(readRange(range, options).text).toBe("");
  });
});

describe("readRange under display: contents", () => {
  // Chrome's checkVisibility() is false for an element without a box: display none on it or an
  // ancestor, and display contents on the element itself. jsdom has no checkVisibility at all.
  const hasBox = (el: Element): boolean => getComputedStyle(el).display !== "contents";
  beforeEach(() => {
    Element.prototype.checkVisibility = function (this: Element) {
      for (let el: Element | null = this; el !== null; el = el.parentElement) {
        if (getComputedStyle(el).display === "none") return false;
      }
      return hasBox(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).checkVisibility;
  });

  // Found by the evaluation: SvelteKit wraps every app in <div style="display: contents">, and
  // every selection on the page came back empty, so no `select` was recorded.
  it("reads text inside a display: contents wrapper (SvelteKit's root)", () => {
    fixture('<div style="display: contents"><main><p id="p">Sales this week</p></main></div>');
    const p = document.getElementById("p") as Element;
    const range = selectAcross(textNode(p), 0, textNode(p), 15);
    expect(readRange(range, options).text).toBe("Sales this week");
  });

  it("still hides text under a display: contents element inside a hidden parent", () => {
    fixture('<div style="display: none"><div style="display: contents"><p id="p">secret</p></div></div>');
    const p = document.getElementById("p") as Element;
    const range = selectAcross(textNode(p), 0, textNode(p), 6);
    expect(readRange(range, options).text).toBe("");
  });
});
