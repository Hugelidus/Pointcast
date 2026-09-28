// @vitest-environment jsdom
import type { CapturedEventDraft } from "@pointcast/core";
import { UI_ATTRIBUTE } from "@pointcast/core";
import { afterEach, describe, expect, it } from "vitest";
import { startCapture } from "./capture";
import type { CaptureOptions } from "./options";
import { loadPlayground, type LoadOptions, type PlaygroundPage } from "./test-utils/playground";

type Win = Window & typeof globalThis;

interface Harness {
  win: Win;
  doc: Document;
  drafts: CapturedEventDraft[];
  targets: Element[];
  stop: () => void;
  setClock: (ms: number) => void;
  q: <T extends Element = HTMLElement>(css: string) => T;
}

const open: Harness[] = [];

afterEach(() => {
  // Closing the window also clears the page's own timers (the toast's setTimeout).
  for (const harness of open.splice(0)) {
    harness.stop();
    harness.win.close();
  }
});

/** Loads a playground page with its scripts running, and records everything startCapture emits. */
function setup(page: PlaygroundPage = "index.html", load: LoadOptions = {}, options: Partial<CaptureOptions> = {}): Harness {
  const dom = loadPlayground(page, { runScripts: true, ...load });
  const win = dom.window as unknown as Win;
  const doc = win.document;
  let clock = 1_000;
  const drafts: CapturedEventDraft[] = [];
  const targets: Element[] = [];
  const stop = startCapture(
    doc,
    (draft, target) => {
      drafts.push(draft);
      targets.push(target);
    },
    { now: () => clock, acceptUntrusted: true, ...options },
  );
  const harness: Harness = {
    win,
    doc,
    drafts,
    targets,
    stop,
    setClock: (ms) => {
      clock = ms;
    },
    q: <T extends Element>(css: string) => {
      const found = doc.querySelector<T>(css);
      if (found === null) throw new Error(`no element for ${css}`);
      return found;
    },
  };
  open.push(harness);
  return harness;
}

// ------------------------------------------------------------------------ input simulation
// Real Chrome order for one press: pointerdown, mousedown, pointerup, mouseup, click.

interface Modifiers {
  altKey?: boolean;
  detail?: number;
}

function mouse(win: Win, target: EventTarget, type: string, init: Modifiers = {}): boolean {
  const Ctor = type.startsWith("pointer") ? win.PointerEvent : win.MouseEvent;
  return target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...init }));
}

function press(win: Win, target: EventTarget, init?: Modifiers): void {
  mouse(win, target, "pointerdown", init);
  mouse(win, target, "mousedown", init);
}

function release(win: Win, target: EventTarget, init?: Modifiers): void {
  mouse(win, target, "pointerup", init);
  mouse(win, target, "mouseup", init);
}

/** A full click; returns false when the click event was cancelled (default prevented). */
function click(win: Win, target: EventTarget, init?: Modifiers): boolean {
  press(win, target, init);
  release(win, target, init);
  return mouse(win, target, "click", init);
}

function setSelection(doc: Document, start: Node, startOffset: number, end: Node, endOffset: number): void {
  const range = doc.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = doc.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

function textNode(el: Element): Text {
  const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && (n as Text).data.trim() !== "");
  if (node === undefined) throw new Error("no text node");
  return node as Text;
}

// ---------------------------------------------------------------------------------- clicks

describe("click capture (plan step 5, revised 2026-09-26: plain clicks are no longer recorded)", () => {
  it("records 3 Alt+clicks as 3 point events with increasing times", () => {
    const { win, drafts, setClock, q } = setup();
    for (const [i, css] of ["#export-btn", "#orders-title", "#orders-table th:nth-child(3)"].entries()) {
      setClock(1_000 * (i + 1));
      click(win, q(css), { altKey: true });
    }
    expect(drafts.map((d) => [d.gesture, d.atStart, d.atEnd, d.element.text])).toEqual([
      ["point", 1_000, 1_000, "Export"],
      ["point", 2_000, 2_000, "Orders"],
      ["point", 3_000, 3_000, "Quantity"],
    ]);
    expect(drafts[0]?.url).toBe("http://localhost:5500/index.html");
  });

  it("lets a plain click execute untouched: Delete removes the row, and nothing is recorded", () => {
    const { win, drafts, q, doc } = setup();
    click(win, q("#orders-table tbody tr:nth-child(2) button"));
    expect(doc.querySelectorAll("#orders-table tbody tr")).toHaveLength(3);
    expect(drafts).toHaveLength(0);
  });

  it("Alt+click points without executing: Delete does not remove the row", () => {
    const { win, drafts, q, doc } = setup();
    const seenByApp: string[] = [];
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      doc.addEventListener(type, () => seenByApp.push(type), true);
    }
    const notCancelled = click(win, q("#orders-table tbody tr:nth-child(2) button"), { altKey: true });

    expect(notCancelled).toBe(false);
    expect(doc.querySelectorAll("#orders-table tbody tr")).toHaveLength(4);
    expect(seenByApp).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      gesture: "point",
      element: { tag: "button", text: "Delete", path: "main › section#orders › table#orders-table › tbody › tr[2] › td[5] › button" },
    });
  });

  it("cancels Alt+click and Alt+middle-click on a link, so it neither navigates nor downloads", () => {
    const { win, drafts, q } = setup();
    const link = q('a[href="other.html"]');
    expect(click(win, link, { altKey: true })).toBe(false);
    const auxclick = new win.MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1, altKey: true });
    expect(link.dispatchEvent(auxclick)).toBe(false);
    expect(drafts.map((d) => [d.gesture, d.element.text])).toEqual([["point", "Customers"]]);
  });

  it("lets a click on a nav link through untouched: no event, and the app's own handler still runs", () => {
    const { win, drafts, doc, q } = setup();
    let appHandlerRan = false;
    doc.addEventListener("click", (event) => {
      appHandlerRan = true;
      event.preventDefault(); // jsdom cannot navigate; stop here once the app is confirmed to react
    });
    click(win, q('a[href="other.html"]'));
    expect(appHandlerRan).toBe(true);
    expect(drafts).toEqual([]);
  });

  it("sees Alt+clicks even when the app stops propagation", () => {
    const { win, drafts, doc, q } = setup();
    doc.addEventListener("click", (event) => event.stopImmediatePropagation(), true);
    click(win, q("#export-btn"), { altKey: true });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ gesture: "point" });
  });

  it("describes the button when the click lands on its icon", () => {
    const { win, drafts, targets, q } = setup();
    click(win, q("#export-btn path"), { altKey: true });
    expect(drafts[0]?.element).toMatchObject({ tag: "button", selector: "#export-btn" });
    expect(targets[0]).toBe(q("#export-btn"));
  });

  it("ignores pointcast's own UI and does not cancel clicks on it", () => {
    const { win, drafts, doc } = setup();
    doc.body.insertAdjacentHTML("beforeend", `<div ${UI_ATTRIBUTE}><button id="rec">REC</button></div>`);
    const rec = doc.getElementById("rec") as HTMLElement;
    click(win, rec);
    expect(click(win, rec, { altKey: true })).toBe(true);
    expect(drafts).toEqual([]);
  });

  it("ignores pointcast's own UI inside a shadow root too: an Alt+click in the note box records nothing", () => {
    const { win, drafts, doc } = setup();
    const host = doc.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "note");
    // Open, so composedPath()[0] is the textarea itself, as a click inside it is seen from window.
    host.attachShadow({ mode: "open" }).innerHTML = "<div><textarea></textarea></div>";
    doc.body.append(host);
    const area = host.shadowRoot!.querySelector("textarea")!;
    expect(click(win, area, { altKey: true })).toBe(true);
    mouse(win, area, "dblclick");
    expect(drafts).toEqual([]);
  });

  it("stops recording and cancelling after stop()", () => {
    const { win, drafts, doc, q, stop } = setup();
    stop();
    click(win, q("#orders-table tbody tr:nth-child(1) button"), { altKey: true });
    expect(drafts).toEqual([]);
    expect(doc.querySelectorAll("#orders-table tbody tr")).toHaveLength(3);
  });

  it("redacts secret query parameters in the event URL", () => {
    const { win, drafts, q } = setup("index.html", { suffix: "?tab=2&token=abc123#access_token=xyz" });
    click(win, q("#export-btn"), { altKey: true });
    expect(drafts[0]?.url).toBe("http://localhost:5500/index.html?tab=2&token=REDACTED#access_token=REDACTED");
  });

  it("redacts personal data in the event URL on a site that is not the user's own app", () => {
    const suffix = "?email=bob%40example.com&phone=612345678&tab=2";
    const remote = setup("index.html", { suffix }, { redactPersonalData: true });
    click(remote.win, remote.q("#export-btn"), { altKey: true });
    expect(remote.drafts[0]?.url).toBe("http://localhost:5500/index.html?email=[redacted]&phone=[redacted]&tab=2");

    const local = setup("index.html", { suffix });
    click(local.win, local.q("#export-btn"), { altKey: true });
    expect(local.drafts[0]?.url).toBe(`http://localhost:5500/index.html${suffix}`);
  });

  it("carries the new URL after an SPA route change driven by an uncaptured plain click", () => {
    const { win, drafts, q } = setup("spa.html");
    click(win, q('[data-route="/reports"]')); // plain click: drives the route change, records nothing
    click(win, q("#view th"), { altKey: true }); // point recorded on the new route
    expect(drafts.map((d) => [d.gesture, d.element.text, d.url])).toEqual([
      ["point", "Report", "http://localhost:5500/spa.html?view=/reports"],
    ]);
    expect(drafts[0]?.element.source).toMatchObject({ file: "src/App.tsx", line: 40 });
  });
});

// ------------------------------------------------------------------------------ selections

describe("selection capture (plan step 6)", () => {
  it("turns a drag over the paragraph into 1 select event, not 2", () => {
    const { win, doc, drafts, setClock, q } = setup();
    const p = q('section[aria-label="Order notes"] p');
    setClock(1_000);
    press(win, p);
    const from = textNode(p).data.indexOf("placed");
    setSelection(doc, textNode(p), from, textNode(p), from + 48);
    setClock(1_600);
    release(win, p);
    setClock(1_610);
    mouse(win, p, "click");

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      gesture: "select",
      atStart: 1_000,
      atEnd: 1_600,
      element: { tag: "p" },
      selection: { text: "placed before noon ship the same day. Bulk order" },
    });
    expect(drafts[0]?.selection?.start).toBeUndefined();
  });

  it("does not record the stale selection again on the click that follows it, nor a later plain click", () => {
    const { win, doc, drafts, q } = setup();
    const p = q('section[aria-label="Order notes"] p');
    press(win, p);
    setSelection(doc, textNode(p), 0, textNode(p), 20);
    release(win, p);
    mouse(win, p, "click");
    click(win, q("#export-btn")); // Chrome keeps the page selection when a button is clicked; still a plain click
    expect(drafts.map((d) => d.gesture)).toEqual(["select"]);
  });

  it("turns a double-clicked word into a selection", () => {
    const { win, doc, drafts, setClock, q } = setup();
    const p = q('section[aria-label="Order notes"] p');
    const text = textNode(p);
    const at = text.data.indexOf("Bulk");
    setClock(1_000);
    click(win, p, { detail: 1 });
    setClock(1_200);
    press(win, p, { detail: 2 });
    setSelection(doc, text, at, text, at + 4); // the browser selects the word on the 2nd press
    setClock(1_250);
    release(win, p, { detail: 2 });
    mouse(win, p, "click", { detail: 2 });
    mouse(win, p, "dblclick", { detail: 2 });

    const selects = drafts.filter((d) => d.gesture === "select");
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatchObject({ atStart: 1_200, atEnd: 1_250, selection: { text: "Bulk" } });
    // The first click of a double-click is a plain click; it is not recorded.
    expect(drafts.map((d) => d.gesture)).toEqual(["select"]);
  });

  it("catches a word selected only after dblclick, without duplicates", () => {
    const { win, doc, drafts, q } = setup();
    const p = q('section[aria-label="Order notes"] p');
    const text = textNode(p);
    press(win, p, { detail: 2 });
    release(win, p, { detail: 2 });
    const at = text.data.indexOf("Orders");
    setSelection(doc, text, at, text, at + 6);
    mouse(win, p, "dblclick", { detail: 2 });
    mouse(win, p, "dblclick", { detail: 2 });
    expect(drafts.filter((d) => d.gesture === "select").map((d) => d.selection?.text)).toEqual(["Orders"]);
  });

  it("uses the list as container for a selection across its items, not main", () => {
    const { win, doc, drafts, q } = setup();
    const items = Array.from(doc.querySelectorAll('section[aria-label="Order notes"] li'));
    press(win, items[0] as Element);
    setSelection(doc, textNode(items[0] as Element), 7, textNode(items[2] as Element), 8);
    release(win, items[2] as Element);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.element).toMatchObject({ tag: "ul", path: "main › section«Order notes» › ul" });
    expect(drafts[0]?.selection).toEqual({ text: "from here… …across this item… …to here" });
  });

  it("records start and end elements when the container is too large (main)", () => {
    const { win, doc, drafts, q } = setup();
    const title = q("#orders-title");
    const p = q('section[aria-label="Order notes"] p');
    press(win, title);
    const end = textNode(p).data.indexOf("Orders") + "Orders".length;
    setSelection(doc, textNode(title), 0, textNode(p), end);
    release(win, p);
    expect(drafts[0]?.element.tag).toBe("main");
    expect(drafts[0]?.selection?.start).toMatchObject({ tag: "h1", text: "Orders" });
    expect(drafts[0]?.selection?.end).toMatchObject({ tag: "p" });
    // Cells from different blocks stay separated: "… $210.25 Delete Notes Orders".
    expect(drafts[0]?.selection?.text).toMatch(/^Orders Export Print Refresh .* \$210\.25 Delete Notes Orders$/);
  });

  it("ignores a drag inside a text field (no visible text selected), and the click that follows records nothing", () => {
    const { win, doc, drafts, q } = setup();
    const textarea = q<HTMLTextAreaElement>("#comment");
    press(win, textarea);
    setSelection(doc, textNode(textarea), 0, textNode(textarea), 7);
    release(win, textarea);
    mouse(win, textarea, "click");
    expect(drafts).toEqual([]);
  });
});

// ------------------------------------------------------------------------------- privacy

describe("privacy canary (plan step 8)", () => {
  const CANARY = "CANARY-7391";
  const TYPED_COMMENT = "Typed comment with the canary CANARY-7391 inside";

  it("never lets a form value or sensitive text reach an event", () => {
    const { win, doc, drafts, q } = setup();
    // The page's own instructions quote the canary literally; they are page text, not a leak.
    q("aside.instructions").remove();

    for (const id of ["password", "api-token", "card-number"]) {
      const input = q<HTMLInputElement>(`#${id}`);
      input.setAttribute("value", CANARY);
      input.value = CANARY;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    const textarea = q<HTMLTextAreaElement>("#comment");
    textarea.value = TYPED_COMMENT;
    textarea.dispatchEvent(new win.Event("input", { bubbles: true }));

    // Click and point at every field, its label, the form, the note and the section.
    const targets = [
      "#display-name", "#password", "#api-token", "#card-number", "#comment", ".private-note",
      'label[for="password"]', 'label[for="api-token"]', 'label[for="card-number"]',
      "#settings-form", 'section[aria-label="Settings"]', "#settings-form button",
    ];
    for (const css of targets) {
      click(win, q(css));
      click(win, q(css), { altKey: true });
    }

    // Select around them: one label, across the whole form, the note, from the notes into the form, everything.
    const select = (start: Node, startOffset: number, end: Node, endOffset: number, on: Element) => {
      press(win, on);
      setSelection(doc, start, startOffset, end, endOffset);
      release(win, on);
      mouse(win, on, "click");
    };
    const form = q("#settings-form");
    const note = q(".private-note");
    const notes = q('section[aria-label="Order notes"] p');
    select(textNode(q('label[for="display-name"]')), 0, textNode(q('label[for="display-name"]')), 7, form);
    select(textNode(q('label[for="display-name"]')), 0, textNode(q("#settings-form button")), 4, form);
    select(textNode(note), 3, textNode(note), 40, note);
    select(textNode(notes), 0, textNode(q('label[for="comment"]')), 7, notes);
    select(doc.body, 0, doc.body, doc.body.childNodes.length, doc.body);

    const selects = drafts.filter((d) => d.gesture === "select");
    expect(selects.map((d) => [d.element.tag, d.selection?.text === "" ? "redacted" : "text"])).toEqual([
      ["label", "text"],
      ["form", "redacted"],
      ["div", "redacted"],
      ["main", "redacted"],
      ["body", "redacted"],
    ]);
    expect(drafts.filter((d) => d.gesture === "point")).toHaveLength(targets.length);

    const json = JSON.stringify(drafts);
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain("Jane Doe");
    expect(json).not.toContain("Private note");
    expect(json).not.toContain("neither its text nor its children");
    expect(json).not.toContain("Typed comment");
    expect(json).not.toContain("Default textarea content");
  });
});

describe("only the user's own input is captured", () => {
  it("ignores clicks created by page scripts (el.click(), dispatchEvent), without cancelling them", () => {
    const dom = loadPlayground("index.html", { runScripts: true });
    const win = dom.window as unknown as Win;
    const drafts: CapturedEventDraft[] = [];
    const stop = startCapture(win.document, (draft) => drafts.push(draft), { now: () => 1_000 });
    try {
      const exportButton = win.document.querySelector("#export-btn") as HTMLElement;
      // An app's own a.click() on a download link, or a script injecting a fake "point".
      exportButton.click();
      const altClickAllowed = click(win, exportButton, { altKey: true });

      expect(drafts).toEqual([]);
      expect(altClickAllowed).toBe(true); // not ours to cancel: the user did not point
    } finally {
      stop();
      win.close();
    }
  });
});

describe("privacy canary: rich-text editors and listboxes (D8)", () => {
  const CANARY = "CANARY-7391";

  it("never records what was typed into a contenteditable editor or chosen in a listbox", () => {
    const { win, doc, drafts, q } = setup();
    q("aside.instructions").remove();
    q("main").insertAdjacentHTML(
      "beforeend",
      `<section id="composer" aria-label="Composer">
         <div id="editor" contenteditable="true" role="textbox" aria-label="Message">
           <p id="typed">Draft with ${CANARY} in it</p><p>second <b id="bold">${CANARY}-bold</b> line</p>
         </div>
         <select id="patients" multiple size="3" aria-label="Patient"><option id="chosen">${CANARY}-option</option><option>Other</option></select>
         <input list="suggestions" aria-label="Search"><datalist id="suggestions"><option>${CANARY}-suggestion</option></datalist>
       </section>`,
    );

    for (const css of ["#editor", "#typed", "#bold", "#chosen", "#patients", "#composer"]) {
      click(win, q(css));
      click(win, q(css), { altKey: true });
    }
    // Select inside the editor, and across the whole composer.
    const typed = textNode(q("#typed"));
    press(win, q("#typed"));
    setSelection(doc, typed, 0, typed, typed.data.length);
    release(win, q("#typed"));
    press(win, q("#composer"));
    setSelection(doc, q("#composer"), 0, q("#composer"), q("#composer").childNodes.length);
    release(win, q("#composer"));

    // The gestures are still recorded, with the grep keys that are not values.
    expect(drafts.filter((d) => d.gesture === "point").map((d) => d.element.label ?? d.element.tag)).toEqual([
      "Message", "p", "b", "option", "Patient", "Composer",
    ]);
    expect(JSON.stringify(drafts)).not.toContain(CANARY);
  });
});
