import { describe, expect, it } from "vitest";
import type { CapturedEventDraft, ElementInfo } from "@pointcast/core";
import { EventLog } from "./event-log";

const element: ElementInfo = {
  tag: "button",
  text: "Export",
  selector: "#export-btn",
  selectorUnique: true,
  path: "main › button#export-btn",
  html: "<button>Export</button>",
};

function draft(atStart: number, atEnd = atStart, extra: Partial<CapturedEventDraft> = {}): CapturedEventDraft {
  return { gesture: "click", atStart, atEnd, url: "http://localhost:5511/", element, ...extra };
}

describe("EventLog", () => {
  it("assigns ids in arrival order and times relative to t0", () => {
    const log = new EventLog(10_000);
    const first = log.add(draft(12_500));
    const second = log.add(draft(11_000, 11_400, { gesture: "select", selection: { text: "Orders" } }));

    expect(first).toMatchObject({ id: "e1", tStart: 2500, tEnd: 2500 });
    expect(second).toMatchObject({ id: "e2", gesture: "select", tStart: 1000, tEnd: 1400 });
    expect(second.selection).toEqual({ text: "Orders" });
    expect(log.events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("removes the last event on undo, and the next event reuses its id", () => {
    const log = new EventLog(10_000);
    log.add(draft(11_000));
    log.add(draft(12_000));
    expect(log.removeLast()?.id).toBe("e2");
    expect(log.add(draft(13_000)).id).toBe("e2");
    expect(log.events.map((e) => e.tStart)).toEqual([1000, 3000]);
    log.removeLast();
    log.removeLast();
    expect(log.removeLast()).toBeUndefined();
  });

  it("clamps times before t0 to zero", () => {
    const log = new EventLog(10_000);
    expect(log.add(draft(9_800, 10_300))).toMatchObject({ tStart: 0, tEnd: 300 });
  });

  it("never lets tEnd precede tStart", () => {
    const log = new EventLog(0);
    expect(log.add(draft(500, 400))).toMatchObject({ tStart: 500, tEnd: 500 });
  });

  it("omits selection when the draft has none", () => {
    const log = new EventLog(0);
    expect("selection" in log.add(draft(1))).toBe(false);
  });
});
