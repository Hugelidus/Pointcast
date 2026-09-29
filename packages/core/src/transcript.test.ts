import { describe, expect, it } from "vitest";
import type { Placement } from "./fuse";
import type { CapturedEvent, Word } from "./schema";
import { renderTranscript } from "./transcript";

const OPTS = { markerBudget: 80, paragraphPauseMs: 2000 };

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function ev(id: string, tStart: number, tEnd = tStart, url = "http://localhost:5500/"): CapturedEvent {
  return {
    id,
    gesture: tStart === tEnd ? "click" : "select",
    tStart,
    tEnd,
    url,
    element: {
      tag: "button",
      text: id,
      selector: `#${id}`,
      selectorUnique: true,
      path: `main › button#${id}`,
      html: `<button>${id}</button>`,
    },
  };
}

function byId(events: CapturedEvent[]): Map<string, CapturedEvent> {
  return new Map(events.map((e) => [e.id, e]));
}

describe("renderTranscript", () => {
  it("renders no-speech placeholder for empty words", () => {
    expect(renderTranscript([], new Map(), [], OPTS)).toEqual(["_No speech was transcribed._"]);
  });

  it("merges 5 events sharing one deictic anchor into a single bracket with a repeat count", () => {
    const words = [w(" estos", 1000, 1300)];
    // Same selector for all 5: one merged part naming the first id plus a repeat count,
    // "e1 ×5", not every id ("e1, e2, e3, e4, e5") — that forced cross-referencing and
    // wasted tokens. The Appendix (renderAppendix) still lists every id for lookup.
    const same = (id: string, t: number) => ({ ...ev(id, t), element: { ...ev(id, t).element, selector: "#shared", path: "main › button#shared", text: "Shared" } });
    const events = [same("e1", 1100), same("e2", 1150), same("e3", 1200), same("e4", 1250), same("e5", 1290)];
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "burst", wordIndex: 0, sharedWith: "e1" },
      { eventId: "e3", kind: "burst", wordIndex: 0, sharedWith: "e1" },
      { eventId: "e4", kind: "burst", wordIndex: 0, sharedWith: "e1" },
      { eventId: "e5", kind: "burst", wordIndex: 0, sharedWith: "e1" },
    ];
    const blocks = renderTranscript(words, byId(events), placements, OPTS);
    // A leading URL separator is always emitted before the first event (currentUrl starts
    // undefined), so the merged bracket is the second block.
    expect(blocks).toEqual(["— / —", expect.stringContaining("e1 ×5")]);
    expect(blocks.join("\n")).not.toContain("e1, e2, e3, e4, e5");
  });

  it("handles overlapping selections without crashing and keeps a deterministic slot order", () => {
    const words = [w(" esto", 1000, 1300), w(" y", 1300, 1400), w(" esto", 1400, 1700)];
    // Two selections that overlap each other in time, each matched to a different deictic.
    const events = [ev("e1", 900, 1500), ev("e2", 1100, 1600)];
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "deictic", wordIndex: 2 },
    ];
    const blocks = renderTranscript(words, byId(events), placements, OPTS);
    expect(blocks.join("\n")).toContain("e1");
    expect(blocks.join("\n")).toContain("e2");
  });

  it("never merges events from different pages into one bracket, even on the same word", () => {
    // fuse() no longer produces a burst across a URL change, but a hand-made placement list
    // can still share one anchor across pages: the page still decides the bracket.
    const words = [w(" esto", 1000, 1300)];
    const events = [ev("e1", 1100, 1100, "http://localhost:5500/a"), ev("e2", 1150, 1150, "http://localhost:5500/b")];
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "burst", wordIndex: 0, sharedWith: "e1" },
    ];
    const blocks = renderTranscript(words, byId(events), placements, OPTS);
    expect(blocks).toEqual([
      "— /a —",
      "esto *[00:01 · button «e1» · e1]*",
      "— /b —",
      "*[00:01 · button «e2» · e2]*",
    ]);
  });

  it("markers of different pages on the same word: the first stays inline, later pages get a separator and a line", () => {
    // Fixture-like: the deictic's burst on /a, then a navigation on /b and /c during the pause
    // right after "esto," — all three anchored after the same word.
    const words = [w(" esto,", 1000, 1300), w(" que", 1800, 2000), w(" es.", 2000, 2200)];
    const events = [
      ev("e1", 1100, 1100, "http://localhost:5500/a"),
      ev("e2", 1200, 1200, "http://localhost:5500/a"),
      ev("e3", 1500, 1500, "http://localhost:5500/b"),
      ev("e4", 1550, 1550, "http://localhost:5500/b"),
      ev("e5", 1600, 1600, "http://localhost:5500/c#/reports"),
    ];
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "burst", wordIndex: 0, sharedWith: "e1" },
      { eventId: "e3", kind: "pause", wordIndex: 0 },
      { eventId: "e4", kind: "burst", wordIndex: 0, sharedWith: "e3" },
      { eventId: "e5", kind: "pause", wordIndex: 0 },
    ];
    expect(renderTranscript(words, byId(events), placements, OPTS)).toEqual([
      "— /a —",
      "esto *[00:01 · button «e1» · e1; button «e2» · e2]*,",
      "— /b —",
      "*[00:01 · button «e3» · e3; button «e4» · e4]*",
      "— /c#/reports —",
      "*[00:01 · button «e5» · e5]*",
      "que es.",
    ]);
  });

  it("a standalone marker at position -1 (before any word) still renders on its own line", () => {
    const words = [w(" Hola", 2000, 2400)];
    const events = [ev("e1", 500)];
    const placements: Placement[] = [{ eventId: "e1", kind: "standalone", wordIndex: -1 }];
    const blocks = renderTranscript(words, byId(events), placements, OPTS);
    expect(blocks[0]).toBe("— / —");
    expect(blocks[1]).toContain("e1");
    expect(blocks[2]).toContain("Hola");
  });

  it("drops a placement whose event id is not in the map, without crashing", () => {
    const words = [w(" Hola", 0, 400)];
    const placements: Placement[] = [{ eventId: "ghost", kind: "word", wordIndex: 0 }];
    expect(() => renderTranscript(words, new Map(), placements, OPTS)).not.toThrow();
    expect(renderTranscript(words, new Map(), placements, OPTS)).toEqual(["Hola"]);
  });

  it("is deterministic for the same input", () => {
    const words = [w(" esto", 0, 300), w(" y", 300, 400), w(" eso", 400, 700)];
    const events = [ev("e1", 100), ev("e2", 500)];
    const placements: Placement[] = [
      { eventId: "e1", kind: "deictic", wordIndex: 0 },
      { eventId: "e2", kind: "deictic", wordIndex: 2 },
    ];
    const map = byId(events);
    const first = renderTranscript(words, map, placements, OPTS);
    for (let i = 0; i < 5; i++) {
      expect(renderTranscript(words, map, placements, OPTS)).toEqual(first);
    }
  });
});
