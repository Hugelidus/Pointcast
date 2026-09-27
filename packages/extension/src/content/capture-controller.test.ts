// @vitest-environment jsdom
import { UI_ATTRIBUTE, type CapturedEventDraft } from "@pointcast/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlayground } from "../lib/test-utils/playground";
import { createCaptureController, type CaptureController } from "./capture-controller";
import { flashElement } from "./flash";
import { createIndicator } from "./indicator";

type Win = Window & typeof globalThis;

interface Harness {
  win: Win;
  doc: Document;
  controller: CaptureController;
  /** Everything the controller did, in order: "send:<gesture>" and "flash:<tag>". */
  calls: string[];
  drafts: CapturedEventDraft[];
}

const opened: Harness[] = [];

afterEach(() => {
  for (const { controller, win } of opened.splice(0)) {
    controller.stop();
    win.close();
  }
});

function setup(flash?: (target: Element) => void): Harness {
  const win = loadPlayground("index.html", { runScripts: true }).window as unknown as Win;
  const doc = win.document;
  const calls: string[] = [];
  const drafts: CapturedEventDraft[] = [];
  const controller = createCaptureController(doc, {
    send: (draft) => {
      calls.push(`send:${draft.gesture}`);
      drafts.push(draft);
    },
    flash: (target) => {
      calls.push(`flash:${target.localName}`);
      flash?.(target);
    },
    options: { now: () => 1_000, acceptUntrusted: true },
  });
  const harness = { win, doc, controller, calls, drafts };
  opened.push(harness);
  return harness;
}

/** A full press in Chrome's order; returns false when the click was cancelled. */
function click(win: Win, target: Element, altKey = false): boolean {
  const init = { bubbles: true, cancelable: true, composed: true, button: 0, altKey };
  target.dispatchEvent(new win.PointerEvent("pointerdown", init));
  target.dispatchEvent(new win.MouseEvent("mousedown", init));
  target.dispatchEvent(new win.PointerEvent("pointerup", init));
  target.dispatchEvent(new win.MouseEvent("mouseup", init));
  return target.dispatchEvent(new win.MouseEvent("click", init));
}

function rows(doc: Document): number {
  return doc.querySelectorAll("#orders-table tbody tr").length;
}

describe("createCaptureController", () => {
  it("captures nothing and leaves Alt+click to the app until started", () => {
    const { win, doc, calls } = setup();
    click(win, doc.querySelector(".delete-row") as Element, true);
    expect(calls).toEqual([]);
    // Not recording: the app is not intercepted, so its handler runs.
    expect(rows(doc)).toBe(3);
  });

  it("sends each draft before flashing the captured element", () => {
    const { win, doc, controller, calls, drafts } = setup();
    controller.start();
    click(win, doc.getElementById("export-btn") as Element, true);
    click(win, doc.getElementById("orders-title") as Element, true);
    expect(calls).toEqual(["send:point", "flash:button", "send:point", "flash:h1"]);
    expect(drafts[0]?.element.selector).toBe("#export-btn");
  });

  it("does not send or flash anything for a plain click", () => {
    const { win, doc, controller, calls } = setup();
    controller.start();
    click(win, doc.getElementById("orders-title") as Element);
    expect(calls).toEqual([]);
  });

  it("starts only once, however many times recording is reported", () => {
    const { win, doc, controller, calls } = setup();
    controller.start();
    controller.start();
    click(win, doc.getElementById("orders-title") as Element, true);
    expect(calls).toEqual(["send:point", "flash:h1"]);
  });

  it("points without executing while started, and gives Alt+click back to the app when stopped", () => {
    const { win, doc, controller, calls } = setup();
    controller.start();
    expect(click(win, doc.querySelector(".delete-row") as Element, true)).toBe(false);
    expect(rows(doc)).toBe(4);

    controller.stop();
    controller.stop();
    expect(click(win, doc.querySelector(".delete-row") as Element, true)).toBe(true);
    expect(rows(doc)).toBe(3);
    expect(calls).toEqual(["send:point", "flash:button"]);
  });

  it("never captures its own REC indicator or highlight flash", () => {
    const { win, doc, controller, drafts } = setup(flashElement);
    controller.start();
    createIndicator(doc).render({ kind: "recording" });
    click(win, doc.getElementById("export-btn") as Element, true);

    const ui = Array.from(doc.querySelectorAll(`[${UI_ATTRIBUTE}]`));
    expect(ui.map((el) => el.getAttribute(UI_ATTRIBUTE)).sort()).toEqual(["flash", "indicator"]);
    for (const el of ui) {
      click(win, el);
      click(win, el, true);
    }
    expect(drafts.map((d) => d.element.selector)).toEqual(["#export-btn"]);

    // Describing the whole document does not mention them either.
    click(win, doc.documentElement, true);
    const html = drafts.at(-1);
    expect(html?.element.tag).toBe("html");
    // Both UI hosts are the last children of <html>; without the exclusion they would show up
    // as trailing "<div></div>" after </body>.
    expect(html?.element.html).toMatch(/<\/body><\/html>$/);
    expect(JSON.stringify(html)).not.toContain(UI_ATTRIBUTE);
  });
});
