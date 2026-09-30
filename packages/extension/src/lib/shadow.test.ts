// @vitest-environment jsdom
import type { CapturedEventDraft } from "@pointcast/core";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { startCapture } from "./capture";
import type { CaptureOptions } from "./options";
import { describeElement, findSource, readablePath } from "./describe";

type Win = Window & typeof globalThis;

interface Page {
  win: Win;
  doc: Document;
  drafts: CapturedEventDraft[];
  /** The open shadow root of the first <x-card>. */
  shadow: ShadowRoot;
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** A page with a web component: <x-card> hosts a shadow tree with a heading, a button and a field. */
function setup(options: Partial<CaptureOptions> = {}, bodyHtml = ""): Page {
  const dom = new JSDOM(
    `<body><main><section id="shop" data-source="src/Shop.tsx:4:3"><x-card></x-card></section>${bodyHtml}</main></body>`,
    { url: "http://localhost:5173/" },
  );
  const win = dom.window as unknown as Win;
  const doc = win.document;
  const shadow = (doc.querySelector("x-card") as Element).attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <h2 part="title">Blue mug</h2>
    <div class="actions"><button class="buy" style="color: rgb(255, 0, 0); padding: 4px 8px">Buy <svg><path/></svg></button></div>
    <label>Card <input autocomplete="cc-number"></label>`;
  const drafts: CapturedEventDraft[] = [];
  stops.push(startCapture(doc, (draft) => drafts.push(draft), { now: () => 1000, acceptUntrusted: true, ...options }));
  return { win, doc, drafts, shadow };
}

function query(root: ParentNode, css: string): Element {
  const found = root.querySelector(css);
  if (found === null) throw new Error(`no element for ${css}`);
  return found;
}

function altClick(win: Win, target: Element): boolean {
  const init = { bubbles: true, cancelable: true, composed: true, button: 0, altKey: true };
  target.dispatchEvent(new win.PointerEvent("pointerdown", init));
  target.dispatchEvent(new win.MouseEvent("mousedown", init));
  target.dispatchEvent(new win.PointerEvent("pointerup", init));
  target.dispatchEvent(new win.MouseEvent("mouseup", init));
  return target.dispatchEvent(new win.MouseEvent("click", init));
}

describe("gestures inside an open shadow root", () => {
  it("captures Alt+click on the inner element (not the host) and cancels it", () => {
    const { win, drafts, shadow } = setup();
    const button = query(shadow, "button.buy");
    expect(altClick(win, query(button, "path"))).toBe(false);
    expect(drafts).toHaveLength(1);
    const element = drafts[0]?.element;
    expect(element).toMatchObject({
      tag: "button",
      text: "Buy",
      path: "main › section#shop › x-card › #shadow-root › … › button",
      selector: "x-card >>> button.buy",
      selectorUnique: false,
      // The source attribute sits outside the component and still counts, across the boundary.
      source: { file: "src/Shop.tsx", line: 4, column: 3, attribute: "data-source", distance: 3 },
    });
  });

  it("reads a selection made inside the shadow tree from the shadow root (Chrome keeps it there)", () => {
    const { win, doc, drafts, shadow } = setup();
    const heading = query(shadow, "h2");
    const range = doc.createRange();
    range.setStart(heading.firstChild as Text, 0);
    range.setEnd(heading.firstChild as Text, 4);
    // Chrome's ShadowRoot.getSelection; jsdom has none, so a minimal stand-in is attached.
    let selected = false;
    Object.assign(shadow, {
      getSelection: () => ({ rangeCount: selected ? 1 : 0, isCollapsed: !selected, getRangeAt: () => range }),
    });
    const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
    heading.dispatchEvent(new win.PointerEvent("pointerdown", init));
    selected = true; // the drag selects "Blue"
    heading.dispatchEvent(new win.PointerEvent("pointerup", init));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      gesture: "select",
      selection: { text: "Blue" },
      element: { tag: "h2", path: "main › section#shop › x-card › #shadow-root › h2" },
    });
  });

  it("still finds that selection when the drag ends outside the component", () => {
    const { win, doc, drafts, shadow } = setup({}, "<p>outside</p>");
    const heading = query(shadow, "h2");
    const range = doc.createRange();
    range.selectNodeContents(heading);
    let selected = false;
    Object.assign(shadow, {
      getSelection: () => ({ rangeCount: selected ? 1 : 0, isCollapsed: !selected, getRangeAt: () => range }),
    });
    const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
    heading.dispatchEvent(new win.PointerEvent("pointerdown", init));
    selected = true;
    query(doc, "p").dispatchEvent(new win.PointerEvent("pointerup", init));
    expect(drafts[0]?.selection?.text).toBe("Blue mug");
  });
});

describe("describing shadow-DOM elements", () => {
  it("places an omitted-path marker after the shadow-root boundary", () => {
    const { shadow } = setup();
    expect(readablePath(query(shadow, "button.buy"))).toBe(
      "main › section#shop › x-card › #shadow-root › … › button",
    );
  });

  it("keeps sensitivity from a marker outside the component", () => {
    const dom = new JSDOM(`<body><div data-sensitive><x-field></x-field></div></body>`);
    const shadow = (dom.window.document.querySelector("x-field") as Element).attachShadow({ mode: "open" });
    shadow.innerHTML = "<span>4111 1111 1111 1111</span>";
    const info = describeElement(query(shadow, "span"));
    expect(info.sensitive).toBe(true);
    expect(info.text).toBe("");
  });

  it("resolves aria-labelledby inside the shadow root", () => {
    const { shadow } = setup();
    query(shadow, "h2").id = "title";
    query(shadow, "button").setAttribute("aria-labelledby", "title");
    expect(describeElement(query(shadow, "button")).label).toBe("Blue mug");
  });

  it("names nested hosts in the path and the selector", () => {
    const { shadow } = setup();
    const inner = query(shadow, ".actions").attachShadow({ mode: "open" });
    inner.innerHTML = "<a href='/cart'>Cart</a>";
    const link = query(inner, "a");
    expect(readablePath(link)).toBe("main › section#shop › x-card › #shadow-root › div › #shadow-root › a");
    expect(describeElement(link).selector).toBe('x-card >>> div.actions >>> a[href="/cart"]');
    expect(findSource(link, ["data-source"])?.file).toBe("src/Shop.tsx");
  });
});

describe("styles of the pointed element", () => {
  it("records the computed values for an Alt+click", () => {
    const { win, drafts, shadow } = setup();
    altClick(win, query(shadow, "button.buy"));
    const styles = drafts[0]?.element.styles ?? {};
    expect(styles.color).toBe("rgb(255, 0, 0)");
    expect(styles.padding).toBe("4px 8px");
    expect(styles.display).toBe("inline-block");
    expect(Object.keys(styles).every((key) => [
      "color", "background-color", "font-size", "font-weight", "padding", "margin", "display", "width", "height",
    ].includes(key))).toBe(true);
  });

  it("skips styles for sensitive elements", () => {
    const { win, drafts, shadow } = setup();
    altClick(win, query(shadow, "input"));
    expect(drafts[0]?.element.sensitive).toBe(true);
    expect(drafts[0]?.element.styles).toBeUndefined();
  });

  it("does not add styles to selections", () => {
    const { win, doc, drafts } = setup({}, "<p>Free shipping over 50 EUR</p>");
    const p = query(doc, "p");
    const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
    p.dispatchEvent(new win.PointerEvent("pointerdown", init));
    const range = doc.createRange();
    range.selectNodeContents(p);
    doc.getSelection()?.addRange(range);
    p.dispatchEvent(new win.PointerEvent("pointerup", init));
    expect(drafts[0]?.gesture).toBe("select");
    expect(drafts[0]?.element.styles).toBeUndefined();
  });
});

describe("redactPersonalData in capture", () => {
  it("redacts the selected text", () => {
    const { win, doc, drafts } = setup({ redactPersonalData: true }, "<p>Write to ana@example.com</p>");
    const p = query(doc, "p");
    const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
    p.dispatchEvent(new win.PointerEvent("pointerdown", init));
    const range = doc.createRange();
    range.selectNodeContents(p);
    doc.getSelection()?.addRange(range);
    p.dispatchEvent(new win.PointerEvent("pointerup", init));
    expect(drafts[0]?.selection?.text).toBe("Write to [redacted]");
    expect(drafts[0]?.element.text).toBe("Write to [redacted]");
  });
});
