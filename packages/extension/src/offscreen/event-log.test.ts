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

  it("removes the last event on undo without reusing its id; the session is renumbered at Stop", () => {
    const log = new EventLog(10_000);
    log.add(draft(11_000));
    log.add(draft(12_000));
    expect(log.removeLast()?.id).toBe("e2");
    // A page may still hold "e2" (an Undo flash, an open note box): it never names another gesture.
    expect(log.add(draft(13_000)).id).toBe("e3");
    expect(log.events.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(log.session().map((e) => `${e.id}@${e.tStart}`)).toEqual(["e1@1000", "e2@3000"]);
    // session() copies: the live ids are untouched.
    expect(log.events.map((e) => e.id)).toEqual(["e1", "e3"]);
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

describe("EventLog notes (typed mode, D12)", () => {
  const draftAt = (at: number) => ({
    gesture: "point" as const,
    atStart: at,
    atEnd: at,
    url: "http://localhost/",
    element: { tag: "a", text: "x", selector: "a", selectorUnique: true, path: "a", html: "<a>x</a>" },
  });

  it("keeps the other ids when a gesture before the last one is removed; the session has e1..eN", () => {
    const log = new EventLog(0);
    for (const at of [10, 20, 30]) log.add(draftAt(at));
    expect(log.remove("e2")?.tStart).toBe(20);
    expect(log.events.map((e) => `${e.id}@${e.tStart}`)).toEqual(["e1@10", "e3@30"]);
    expect(log.add(draftAt(40)).id).toBe("e4");
    expect(log.session().map((e) => `${e.id}@${e.tStart}`)).toEqual(["e1@10", "e2@30", "e3@40"]);
  });

  it("a note box still open in another tab writes onto its own gesture after an earlier one is cancelled", () => {
    // Tab 1 cancels A (e1) while tab 2's box for B (e2) and tab 3's for C (e3) are open.
    const log = new EventLog(0);
    for (const at of [10, 20, 30]) log.add(draftAt(at));
    log.setNote("e2", "note for B");
    log.remove("e1");
    expect(log.setNote("e2", "note for B, continued")).toBe(true);
    expect(log.setNote("e3", "note for C")).toBe(true);
    // Tab 2 cancels B with its (still valid) id: C stays.
    expect(log.remove("e2")?.tStart).toBe(20);
    expect(log.session().map((e) => `${e.id}@${e.tStart} ${e.note}`)).toEqual(["e1@30 note for C"]);
  });

  it("stores the note cleaned and capped", () => {
    const log = new EventLog(0);
    log.add(draftAt(10));
    expect(log.setNote("e1", " a\r\nb ")).toBe(true);
    expect(log.events[0]?.note).toBe("a\nb");
    log.setNote("e1", "y".repeat(5000));
    expect(log.events[0]?.note).toHaveLength(2000);
  });
});
