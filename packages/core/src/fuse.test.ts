import { describe, expect, it } from "vitest";
import { fuse, intervalGap, type Placement } from "./fuse";
import type { CapturedEvent, Gesture, Word } from "./schema";

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

/**
 * A zero-length event is an Alt+click "point" unless told otherwise: D4's cost examples are
 * about pointing, and plain clicks carry D7's extra match cost (tested on their own below).
 */
function ev(
  id: string,
  tStart: number,
  tEnd = tStart,
  { gesture, url = "http://localhost:5500/" }: { gesture?: Gesture; url?: string } = {},
): CapturedEvent {
  return {
    id,
    gesture: gesture ?? (tStart === tEnd ? "point" : "select"),
    tStart,
    tEnd,
    url,
    element: {
      tag: "button",
      text: id,
      selector: `#${id}`,
      selectorUnique: true,
      path: `main › button#${id}`,
      html: `<button id="${id}">${id}</button>`,
    },
  };
}

/** Compact view of placements so expectations read like a table. */
function summary(placements: Placement[]): string[] {
  return placements.map(
    (p) => `${p.eventId}:${p.kind}:${p.wordIndex}${p.sharedWith ? `<${p.sharedWith}` : ""}`,
  );
}

describe("intervalGap", () => {
  it("is 0 for overlapping or touching intervals and the distance otherwise", () => {
    expect(intervalGap(0, 10, 5, 20)).toBe(0);
    expect(intervalGap(0, 10, 10, 20)).toBe(0);
    expect(intervalGap(0, 10, 15, 20)).toBe(5);
    expect(intervalGap(15, 20, 0, 10)).toBe(5);
    expect(intervalGap(7, 7, 7, 7)).toBe(0);
  });
});

describe("fuse: deictic alignment", () => {
  it("anchors one event to the one deictic said at the same time", () => {
    const words = [w(" Esto", 1000, 1300), w(" me", 1400, 1500), w(" gusta.", 1500, 1900)];
    const result = fuse([ev("e1", 1200)], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:0"]);
    expect(result.alignmentCost).toBe(0);
  });

  it("solves the D4 worked example where greedy nearest-neighbour fails", () => {
    // "this" at 1.0 s, "and this" at 2.1 s, clicks at 2.0 s and 2.6 s.
    // Greedy would give the first click to the second "this" (0.1 s away).
    // DP: 1.0 + 0.5 = 1.5 beats 0.1 + 2.5 + 0.3 = 2.9.
    const words = [w(" this", 1000, 1000), w(" and", 2050, 2050), w(" this", 2100, 2100)];
    const result = fuse([ev("e1", 2000), ev("e2", 2600)], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:0", "e2:deictic:2"]);
    expect(result.alignmentCost).toBeCloseTo(1.5, 10);
  });

  it("does not match a deictic farther than windowMs", () => {
    const words = [
      w(" Esto", 0, 300),
      w(" es", 300, 500),
      w(" una", 500, 700),
      w(" prueba", 700, 5000),
      w(" larga", 5000, 6000),
    ];
    const result = fuse([ev("e1", 5500)], words);
    expect(summary(result.placements)).toEqual(["e1:word:4"]);
    // The unused deictic costs 0.3 and the event 2.5.
    expect(result.alignmentCost).toBeCloseTo(2.8, 10);
  });

  it("leaves a deictic without an event unmatched and produces no placement", () => {
    const words = [w(" Esto", 0, 300), w(" está", 300, 600), w(" mal.", 600, 900)];
    expect(fuse([], words)).toEqual({ placements: [], alignmentCost: 0.3 });
  });

  it("breaks ties toward pairing the earlier deictic", () => {
    const words = [w(" this", 1000, 1000), w(" or", 2000, 2000), w(" this", 3000, 3000)];
    expect(summary(fuse([ev("e1", 2000)], words).placements)).toEqual(["e1:deictic:0"]);
  });

  it("breaks ties toward pairing the earlier event", () => {
    const words = [w(" esto", 1000, 1200)];
    expect(summary(fuse([ev("e1", 1100), ev("e2", 1100)], words).placements)).toEqual([
      "e1:deictic:0",
      "e2:burst:0<e1",
    ]);
  });

  it("measures selections as intervals: overlap means distance 0", () => {
    const words = [w(" this", 1000, 1200), w(" paragraph", 1200, 1800), w(" that", 4100, 4300)];
    // The selection started 2.6 s before "that" (outside the window if it were a point),
    // but the interval overlaps "that", so the distance is 0 and it beats "this" (0.3 s away).
    const result = fuse([ev("e1", 1500, 4200)], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:2"]);
    // Only cost: the unused "this" (0.3).
    expect(result.alignmentCost).toBeCloseTo(0.3, 10);
  });

  it("honours custom options: deictic list and window", () => {
    const words = [w(" Voilà", 1000, 1300), w(" ici", 1300, 1600)];
    const custom = fuse([ev("e1", 1100)], words, { deictics: ["voilà"] });
    expect(summary(custom.placements)).toEqual(["e1:deictic:0"]);

    const english = [w(" this", 1000, 1000), w(" one", 1000, 3000)];
    const narrow = fuse([ev("e1", 1500)], english, { windowMs: 400 });
    expect(summary(narrow.placements)).toEqual(["e1:word:1"]);
  });
});

describe("fuse: unmatched events", () => {
  it('"these three columns" + 3 clicks share the deictic anchor through a chained burst', () => {
    const words = [w(" estas", 1000, 1300), w(" tres", 1300, 1600), w(" columnas", 1600, 2100)];
    // e3 is 1.2 s from e1 (more than burstGapMs) but only 0.6 s from e2: the chain holds.
    const result = fuse([ev("e1", 1100), ev("e2", 1700), ev("e3", 2300)], words);
    expect(summary(result.placements)).toEqual([
      "e1:deictic:0",
      "e2:burst:0<e1",
      "e3:burst:0<e1",
    ]);
  });

  it("a burst member joins the nearest matched event of its burst", () => {
    const words = [
      w(" this", 1000, 1000),
      w(" and", 1000, 2900),
      w(" this", 3000, 3000),
      w(" too", 3000, 3500),
    ];
    const result = fuse([ev("e1", 1000), ev("e2", 2000), ev("e3", 2900)], words);
    expect(summary(result.placements)).toEqual([
      "e1:deictic:0",
      "e2:burst:2<e3",
      "e3:deictic:2",
    ]);
  });

  it("an event without a deictic goes to the nearest pause within pauseRadiusMs", () => {
    // Pause of 400 ms between "tabla" and "de": a click 100 ms before it, and one in its first half.
    const words = [
      w(" La", 0, 200),
      w(" tabla", 200, 600),
      w(" de", 1000, 1100),
      w(" pedidos", 1100, 1500),
    ];
    expect(summary(fuse([ev("e1", 500)], words).placements)).toEqual(["e1:pause:1"]);
    expect(summary(fuse([ev("e1", 750)], words).placements)).toEqual(["e1:pause:1"]);
  });

  it("an event late in a pause, or running into the next word, goes with what is said next", () => {
    // D4 note 2026-09-27. Pause 600-1000 ms (midpoint 800) between "tabla" and "de".
    const words = [
      w(" La", 0, 200),
      w(" tabla", 200, 600),
      w(" de", 1000, 1100),
      w(" pedidos", 1100, 1500),
    ];
    // Second half of the pause: after the next word.
    expect(summary(fuse([ev("e1", 900)], words).placements)).toEqual(["e1:word:2"]);
    // After the pause: after the word it lands on.
    expect(summary(fuse([ev("e1", 1300)], words).placements)).toEqual(["e1:word:3"]);
    // A selection from the first half of the pause into "de".
    expect(summary(fuse([ev("e1", 700, 1050)], words).placements)).toEqual(["e1:word:2"]);
    // Exactly at the midpoint, still the pause.
    expect(summary(fuse([ev("e1", 800)], words).placements)).toEqual(["e1:pause:1"]);
  });

  it("the eval's shadcn case: a selection at the start of a sentence belongs to that sentence", () => {
    // Real Whisper times from the shadcn-admin recording (eval 2026-09-27): the user selects
    // "You made 265 sales this month." as they say "Y el texto de ventas recientes". Anchored to
    // the pause before "Y", it used to land in the previous sentence ("…fuera. [e5]").
    const words = [
      w(" no", 21590, 21790),
      w(" hace", 21790, 22130),
      w(" falta,", 22130, 22670),
      w(" fuera.", 22950, 24910),
      w(" Y", 25530, 25650),
      w(" el", 25650, 25910),
      w(" texto", 25910, 26090),
      w(" de", 26090, 26290),
      w(" ventas", 26290, 26670),
      w(" recientes,", 26670, 27470),
    ];
    const { placements } = fuse([ev("e5", 25636, 25677)], words);
    expect(summary(placements)).toEqual(["e5:word:4"]);
    expect(words[placements[0].wordIndex].text).toBe(" Y");
  });

  it("an event with no pause nearby goes after the nearest word", () => {
    const words = [
      w(" La", 0, 200),
      w(" tabla", 200, 600),
      w(" de", 1000, 1100), // pause 600-1000, but 1.6 s away from the click
      w(" pedidos", 1100, 1500),
      w(" tiene", 1500, 1900),
      w(" que", 1900, 2200),
      w(" ordenarse", 2200, 2700),
      w(" bien", 2700, 3000),
    ];
    expect(summary(fuse([ev("e1", 2600)], words).placements)).toEqual(["e1:word:6"]);
  });

  it("word ties go to the earlier word", () => {
    const words = [w(" uno", 0, 1000), w(" dos", 1100, 2000)];
    // 50 ms from both words; the 100 ms gap is below pauseMinGapMs, so it is not a pause.
    expect(summary(fuse([ev("e1", 1050)], words).placements)).toEqual(["e1:word:0"]);
  });

  it("an event inside a long silence becomes standalone, positioned after the previous word", () => {
    const words = [w(" Primero", 0, 500), w(" luego", 5000, 5400)];
    expect(summary(fuse([ev("e1", 2500)], words).placements)).toEqual(["e1:standalone:0"]);
  });

  it("an event inside a short silence is anchored to it as a pause, or to what follows it", () => {
    const words = [w(" Primero", 0, 500), w(" luego", 3000, 3400)];
    expect(summary(fuse([ev("e1", 1200)], words).placements)).toEqual(["e1:pause:0"]);
    // Past the silence's midpoint (1750 ms): with "luego".
    expect(summary(fuse([ev("e1", 2500)], words).placements)).toEqual(["e1:word:1"]);
  });

  it("an event before the first word is standalone at position -1", () => {
    const words = [w(" Hola", 2000, 2400), w(" mundo", 2400, 2800)];
    expect(summary(fuse([ev("e1", 500)], words).placements)).toEqual(["e1:standalone:-1"]);
  });

  it("an event after the last word is standalone after the last word", () => {
    const words = [w(" Hola", 2000, 2400), w(" mundo", 2400, 2800)];
    expect(summary(fuse([ev("e1", 2900)], words).placements)).toEqual(["e1:standalone:1"]);
  });

  it("a burst without any matched event is anchored once, as a unit", () => {
    const words = [
      w(" La", 0, 200),
      w(" tabla", 200, 600),
      w(" de", 1000, 1100),
      w(" pedidos", 1100, 1500),
    ];
    // Both in the first half of the pause (600-1000 ms): the burst takes the pause as one.
    expect(summary(fuse([ev("e1", 620), ev("e2", 780)], words).placements)).toEqual([
      "e1:pause:1",
      "e2:burst:1<e1",
    ]);
    // Both after it: the burst goes with the word its span starts on.
    expect(summary(fuse([ev("e1", 1200), ev("e2", 1600)], words).placements)).toEqual([
      "e1:word:3",
      "e2:burst:3<e1",
    ]);
  });

  it("with no words at all, every event is standalone and bursts still group", () => {
    const result = fuse([ev("e1", 100), ev("e2", 600), ev("e3", 5000)], []);
    expect(summary(result.placements)).toEqual([
      "e1:standalone:-1",
      "e2:burst:-1<e1",
      "e3:standalone:-1",
    ]);
    expect(result.alignmentCost).toBeCloseTo(7.5, 10);
  });
});

describe("fuse: a burst never spans a URL change", () => {
  // No pauses (words are contiguous), so an unmatched event goes after its nearest word.
  const words = [
    w(" Mira", 0, 300),
    w(" esto", 300, 700),
    w(" y", 700, 900),
    w(" luego", 900, 1300),
    w(" sigue", 1300, 1700),
  ];

  it("an event on another page is not chained into the previous page's burst", () => {
    // 600 ms apart (within burstGapMs), but e2 is the click that happened on the next page.
    const result = fuse(
      [
        ev("e1", 500, 500, { url: "http://localhost:5500/a" }),
        ev("e2", 1100, 1100, { gesture: "click", url: "http://localhost:5500/b" }),
      ],
      words,
    );
    expect(summary(result.placements)).toEqual(["e1:deictic:1", "e2:word:3"]);
  });

  it("a burst of unmatched events is split at the URL change and each part anchored alone", () => {
    // Pause 600-1000 ms between "tabla" and "de"; both clicks are within pauseRadiusMs of it.
    const withPause = [
      w(" La", 0, 200),
      w(" tabla", 200, 600),
      w(" de", 1000, 1100),
      w(" pedidos", 1100, 1500),
      w(" grande", 1500, 1900),
    ];
    const result = fuse(
      [
        ev("e1", 650, 650, { gesture: "click", url: "http://localhost:5500/a" }),
        ev("e2", 750, 750, { gesture: "click", url: "http://localhost:5500/b" }),
      ],
      withPause,
    );
    // Same pause, but two anchors of their own: neither shares the other's (no "burst").
    expect(summary(result.placements)).toEqual(["e1:pause:1", "e2:pause:1"]);
  });

  it("compares pages the way URL separators do: scroll fragments ignored, route fragments kept", () => {
    const result = fuse(
      [
        ev("e1", 500, 500, { url: "http://localhost:5500/a" }),
        ev("e2", 1100, 1100, { gesture: "click", url: "http://localhost:5500/a#top" }),
        ev("e3", 1700, 1700, { gesture: "click", url: "http://localhost:5500/a#/orders" }),
      ],
      words,
    );
    expect(summary(result.placements)).toEqual(["e1:deictic:1", "e2:burst:1<e1", "e3:word:4"]);
  });
});

describe("fuse: plain clicks vs pointing gestures (D7)", () => {
  // "y" ends 100 ms before "esto" starts.
  const words = [w(" y", 600, 900), w(" esto", 1000, 1200), w(" también", 1200, 1700)];

  it("a plain click does not steal a deictic from a nearby Alt+click point", () => {
    // The click is inside the word (0 ms), the point 300 ms before it: 300 < 0 + 500.
    const result = fuse([ev("e1", 700), ev("e2", 1100, 1100, { gesture: "click" })], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:1", "e2:burst:1<e1"]);
    // The point's 0.3 plus the click left unmatched (2.5).
    expect(result.alignmentCost).toBeCloseTo(2.8, 10);
  });

  it("a selection also wins over a nearby plain click", () => {
    const result = fuse([ev("e1", 500, 700), ev("e2", 1100, 1100, { gesture: "click" })], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:1", "e2:burst:1<e1"]);
  });

  it("a plain click still matches a deictic when no pointing gesture is nearby", () => {
    const result = fuse([ev("e1", 1100, 1100, { gesture: "click" })], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:1"]);
    expect(result.alignmentCost).toBeCloseTo(0.5, 10);
  });

  it("windowMs limits the distance, not the cost: a click 1.9 s away still matches", () => {
    const result = fuse([ev("e1", 3100, 3100, { gesture: "click" })], [w(" esto", 1000, 1200)]);
    expect(summary(result.placements)).toEqual(["e1:deictic:0"]);
    expect(result.alignmentCost).toBeCloseTo(2.4, 10);
  });

  it("the penalty settles near-ties only: a click much closer than the point still wins", () => {
    // Point 600 ms before the word, click inside it: 600 > 0 + 500.
    const result = fuse([ev("e1", 400), ev("e2", 1100, 1100, { gesture: "click" })], words);
    expect(summary(result.placements)).toEqual(["e1:burst:1<e2", "e2:deictic:1"]);
  });

  it("clickMatchPenaltyMs: 0 treats all gestures equally (the Phase 1 behaviour)", () => {
    const result = fuse([ev("e1", 700), ev("e2", 1100, 1100, { gesture: "click" })], words, {
      clickMatchPenaltyMs: 0,
    });
    expect(summary(result.placements)).toEqual(["e1:burst:1<e2", "e2:deictic:1"]);
  });
});

describe("fuse: general properties", () => {
  it("returns an empty result for empty inputs", () => {
    expect(fuse([], [])).toEqual({ placements: [], alignmentCost: 0 });
  });

  it("sorts events by time and never mutates its inputs", () => {
    const words = [w(" this", 1000, 1000), w(" and", 2050, 2050), w(" this", 2100, 2100)];
    const events = [ev("e2", 2600), ev("e1", 2000)];
    const eventsCopy = JSON.parse(JSON.stringify(events));
    const wordsCopy = JSON.parse(JSON.stringify(words));
    const result = fuse(events, words);
    expect(summary(result.placements)).toEqual(["e1:deictic:0", "e2:deictic:2"]);
    expect(events).toEqual(eventsCopy);
    expect(words).toEqual(wordsCopy);
  });

  it("is deterministic", () => {
    const words = [
      w(" Esto", 0, 300),
      w(" y", 300, 400),
      w(" esto", 400, 700),
      w(" y", 1500, 1600),
      w(" aquí", 1600, 1900),
    ];
    const events = [ev("e1", 200), ev("e2", 500), ev("e3", 600), ev("e4", 1000), ev("e5", 9000)];
    const first = fuse(events, words);
    for (let i = 0; i < 5; i++) {
      expect(fuse(events, words)).toEqual(first);
    }
  });
});

describe("fuse: deictic recognition edge cases", () => {
  it("recognizes deictics with Spanish punctuation, accents and uppercase", () => {
    const words = [
      w(" ¡Esto!", 0, 300),
      w(" mira", 300, 600),
      w(" AQUÍ", 600, 900),
      w(" y", 900, 1000),
      w(" ESTO,", 1000, 1300),
    ];
    const result = fuse([ev("e1", 100), ev("e2", 700), ev("e3", 4000)], words);
    // e1 -> "¡Esto!" (0), e2 -> "AQUÍ" (2); e3 is far from every word (> window), so it is
    // left as a standalone/word placement, not a deictic match.
    expect(summary(result.placements).slice(0, 2)).toEqual(["e1:deictic:0", "e2:deictic:2"]);
  });

  it('does not treat the English contraction "that\'s" as the deictic "that"', () => {
    // normalizeWord strips the apostrophe without inserting a break, so "that's" -> "thats",
    // which is not in the default deictic list (only "that" is).
    const words = [w(" that's", 1000, 1300), w(" nice", 1300, 1600)];
    const result = fuse([ev("e1", 1100)], words);
    expect(summary(result.placements)).toEqual(["e1:word:0"]);
  });

  it('a custom deictic list can opt in to a bare contraction form like "thats"', () => {
    const words = [w(" that's", 1000, 1300), w(" nice", 1300, 1600)];
    const result = fuse([ev("e1", 1100)], words, { deictics: ["thats"] });
    expect(summary(result.placements)).toEqual(["e1:deictic:0"]);
  });

  it("plural deictics anchor two independent bursts in the same session", () => {
    const words = [
      w(" estas", 0, 300),
      w(" columnas", 300, 700),
      w(" y", 3000, 3100),
      w(" aquellas", 3100, 3400),
      w(" filas", 3400, 3800),
    ];
    // Two separate 2-click bursts, each near one deictic, far apart from each other.
    const result = fuse([ev("e1", 100), ev("e2", 500), ev("e3", 3200), ev("e4", 3600)], words);
    expect(summary(result.placements)).toEqual([
      "e1:deictic:0",
      "e2:burst:0<e1",
      "e3:deictic:3",
      "e4:burst:3<e3",
    ]);
  });

  it("an unmatched deictic next to a matched one does not disturb the matched pair", () => {
    // "esto" at 0 has no nearby event (isolated, > window from anything); "esto" at 5000 is
    // matched by e1. The unmatched deictic must not steal the match or shift its cost.
    const words = [w(" esto", 0, 300), w(" y", 2000, 2100), w(" esto", 5000, 5300)];
    const result = fuse([ev("e1", 5100)], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:2"]);
    // Only cost: the unused first "esto" (0.3).
    expect(result.alignmentCost).toBeCloseTo(0.3, 10);
  });
});

describe("fuse: overlapping selections", () => {
  it("handles two selections that overlap each other in time without crossing or crashing", () => {
    const words = [w(" esto", 1000, 1300), w(" y", 1300, 1400), w(" eso", 1400, 1700)];
    // e1 = [900, 1500], e2 = [1100, 1600]: they overlap each other, but each is closest to a
    // different deictic.
    const result = fuse([ev("e1", 900, 1500), ev("e2", 1100, 1600)], words);
    expect(summary(result.placements)).toEqual(["e1:deictic:0", "e2:deictic:2"]);
  });

  it("a selection fully containing another still produces one placement per event", () => {
    const words = [w(" esto", 1000, 1300)];
    const outer = ev("e1", 0, 5000);
    const inner = ev("e2", 1000, 1300);
    const result = fuse([outer, inner], words);
    expect(result.placements).toHaveLength(2);
    expect(result.placements.map((p) => p.eventId).sort()).toEqual(["e1", "e2"]);
  });
});

describe("fuse: performance", () => {
  it("stays fast for a long session: 500 events and 5000 words", () => {
    const words: Word[] = [];
    for (let i = 0; i < 5000; i++) {
      const start = i * 400;
      // Sprinkle deictics every ~10th word so alignment has real work to do.
      words.push(w(i % 10 === 0 ? " esto" : " palabra", start, start + 300));
    }
    const events: CapturedEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push(ev(`e${i}`, i * 4000 + 100));
    }
    const start = Date.now();
    const result = fuse(events, words);
    const elapsedMs = Date.now() - start;
    expect(result.placements).toHaveLength(500);
    // Generous ceiling for a CI/laptop CPU; the DP is events x deictics, not events x words.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
