import { describe, expect, it } from "vitest";
import { estimateTokens, renderMarkdown, type RenderOptions } from "./render";
import type { CapturedEvent, ElementInfo, SessionFile, Word, WordsFile } from "./schema";

/** These tests cover the classic format; "requests" (the default) has requests.test.ts. */
const renderClassic = (s: SessionFile, words: WordsFile, options: Partial<RenderOptions> = {}) =>
  renderMarkdown(s, words, { format: "classic", ...options });

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function element(tag: string, text: string, selector: string, extra: Partial<ElementInfo> = {}) {
  return {
    tag,
    text,
    selector,
    selectorUnique: true,
    path: `main › ${tag}`,
    html: `<${tag}>${text}</${tag}>`,
    ...extra,
  };
}

function click(id: string, t: number, el: ElementInfo, url = "http://localhost:5500/"): CapturedEvent {
  return { id, gesture: "point", tStart: t, tEnd: t, url, element: el };
}

function session(events: CapturedEvent[], durationMs = 14250): SessionFile {
  return {
    schemaVersion: 1,
    id: "2026-09-26_18-30-05",
    startedAt: "2026-09-26T16:30:05.123Z",
    t0: 1790440205123,
    durationMs,
    audio: { file: "audio.wav", format: "wav", sampleRate: 16000, channels: 1 },
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events,
  };
}

function transcript(words: Word[], language = "es"): WordsFile {
  return { schemaVersion: 1, engine: "test-engine", language, words };
}

/** The text between "## Transcript" and "## Appendix". */
function transcriptSection(markdown: string): string {
  return markdown.split("## Transcript\n\n")[1].split("\n\n## Appendix")[0];
}

const QUANTITY = element("th", "Quantity", "#orders-table > thead > tr > th:nth-of-type(3)", {
  path: "main › section#orders › table#orders-table › thead › tr › th[3]",
});

const EXPORT = element("button", "Export", '[data-testid="export"]', {
  label: "Export filtered rows",
  path: "main › div.toolbar › button[2]",
  html: '<button data-testid="export" aria-label="Export filtered rows">Export</button>',
  source: { file: "src/components/Toolbar.tsx", line: 12, attribute: "data-source", distance: 1 },
});

const SPANISH_WORDS = [
  w(" En", 1000, 1200),
  w(" la", 1200, 1300),
  w(" tabla", 1300, 1700),
  w(" de", 1700, 1800),
  w(" pedidos,", 1800, 2400),
  w(" esto,", 3800, 4200),
  w(" me", 4300, 4400),
  w(" gustaría", 4400, 4900),
  w(" ordenarlo.", 4900, 5600),
  // 2.4 s pause: new paragraph (but not a long silence).
  w(" Y", 8000, 8200),
  w(" este", 8200, 8500),
  w(" botón", 8500, 8900),
  w(" solo", 8900, 9200),
  w(" debería", 9200, 9600),
  w(" exportar", 9600, 10100),
  w(" lo", 10100, 10200),
  w(" filtrado.", 10200, 10900),
];

const SPANISH_EVENTS: CapturedEvent[] = [
  {
    id: "e1",
    gesture: "select",
    tStart: 3820,
    tEnd: 4410,
    url: "http://localhost:5500/",
    element: QUANTITY,
    selection: { text: "Quantity" },
  },
  click("e2", 8400, EXPORT, "http://localhost:5500/orders"),
  // Same element again, after speech ended: standalone line, one appendix entry.
  click("e3", 13000, EXPORT, "http://localhost:5500/orders"),
];

describe("renderMarkdown", () => {
  it("renders header, transcript with markers and URL separators, and a de-duplicated appendix", () => {
    const md = renderClassic(session(SPANISH_EVENTS), transcript(SPANISH_WORDS));
    expect(md).toBe(`# pointcast session 2026-09-26\\_18-30-05

2026-09-26 16:30 UTC · 00:14 · 3 events · transcript: test-engine (es)

Pointing gestures appear inline as *[time · element · source · id]*; the Appendix details each element. An id like "e2 ×5" means the same element was pointed at 5 times — the Appendix lists every one. The time becomes a range ("00:26–00:29") when a marker's events span more than 1 s.

## Transcript

— / —

En la tabla de pedidos, esto *[00:03 · th «Quantity» · e1]*, me gustaría ordenarlo.

— /orders —

Y este *[00:08 · button «Export» · Toolbar.tsx:12 · e2]* botón solo debería exportar lo filtrado.

*[00:13 · button «Export» · Toolbar.tsx:12 · e3]*

## Appendix

### e1 · th «Quantity»

- e1: select at 00:03, deictic «esto»; selected «Quantity»
- path: \`main › section#orders › table#orders-table › thead › tr › th[3]\`
- selector: \`#orders-table > thead > tr > th:nth-of-type(3)\` (unique)
- url: \`http://localhost:5500/\`

\`\`\`html
<th>Quantity</th>
\`\`\`

### e2, e3 · button «Export»

- e2: point at 00:08, deictic «este»
- e3: point at 00:13, standalone (no speech nearby)
- path: \`main › div.toolbar › button[2]\`
- selector: \`[data-testid="export"]\` (unique)
- source: \`src/components/Toolbar.tsx:12\` (ancestor +1)
- url: \`http://localhost:5500/orders\`
- label: «Export filtered rows»

\`\`\`html
<button data-testid="export" aria-label="Export filtered rows">Export</button>
\`\`\`
`);
  });

  it('merges "these three columns" + 3 clicks into one bracket', () => {
    const words = [
      w(" Ordena", 0, 400),
      w(" estas", 1000, 1300),
      w(" tres", 1300, 1600),
      w(" columnas.", 1600, 2100),
    ];
    const events = [
      click("e1", 1100, element("th", "Price", "#price")),
      click("e2", 1700, element("th", "Quantity", "#qty")),
      click("e3", 2300, element("th", "Total", "#total")),
    ];
    const md = renderClassic(session(events, 3000), transcript(words));
    // e1..e3 span 1100..2300 ms (1.2 s > 1 s), so the marker's clock becomes a range.
    expect(transcriptSection(md)).toBe(
      "— / —\n\n" +
        "Ordena estas *[00:01–00:02 · th «Price» · e1; th «Quantity» · e2; th «Total» · e3]* tres columnas.",
    );
    expect(md).toContain("- e2: point at 00:01, burst with e1\n");
  });

  it("puts events before speech on their own line and announces each URL change", () => {
    const words = [w(" Y", 3000, 3200), w(" aquí", 3200, 3600), w(" también.", 3600, 4200)];
    const events = [
      click("e1", 500, element("button", "A", "#a")),
      click("e2", 800, element("button", "B", "#b")),
      click("e3", 3300, element("a", "C", "#c"), "http://localhost:5500/users?tab=2#top"),
    ];
    const md = renderClassic(session(events, 5000), transcript(words));
    expect(transcriptSection(md)).toBe(
      [
        "— / —",
        "*[00:00 · button «A» · e1; button «B» · e2]*",
        "— /users?tab=2 —",
        "Y aquí *[00:03 · a «C» · e3]* también.",
      ].join("\n\n"),
    );
  });

  it("puts a URL separator at the latest sentence end, not mid-phrase", () => {
    const words = [
      w(" Mira", 0, 300),
      w(" esto.", 300, 600),
      w(" Ahora", 700, 1000),
      w(" vamos", 1000, 1300),
      w(" aquí.", 1300, 1600),
    ];
    const events = [
      click("e1", 400, element("h1", "Orders", "#title")),
      click("e2", 1400, element("a", "Users", "#users"), "http://localhost:5500/users"),
    ];
    const md = renderClassic(session(events, 2000), transcript(words));
    expect(transcriptSection(md)).toBe(
      [
        "— / —",
        "Mira esto *[00:00 · h1 «Orders» · e1]*.",
        "— /users —",
        "Ahora vamos aquí *[00:01 · a «Users» · e2]*.",
      ].join("\n\n"),
    );
  });

  it("never lets a burst span a URL change: each page gets its own marker after a separator", () => {
    // Point at Export on "esto", then a rapid navigation through three pages in the first half
    // of the pause after it (800-1700 ms), every click within burstGapMs of the previous one.
    const words = [w(" Y", 0, 300), w(" esto,", 300, 800), w(" que", 1700, 1900), w(" es.", 1900, 2200)];
    const plain = (id: string, t: number, el: ElementInfo, url: string): CapturedEvent => ({
      ...click(id, t, el, url),
      gesture: "click",
    });
    const events = [
      click("e1", 500, EXPORT, "http://localhost:5500/index.html"),
      plain("e2", 1000, element("a", "Customers", "#customers"), "http://localhost:5500/index.html"),
      plain("e3", 1100, element("button", "View orders", "#view"), "http://localhost:5500/other.html"),
      plain("e4", 1200, element("button", "Reports", "#reports"), "http://localhost:5500/spa.html"),
    ];
    const md = renderClassic(session(events, 2500), transcript(words));
    expect(transcriptSection(md)).toBe(
      [
        "— /index.html —",
        "Y esto *[00:00 · button «Export» · Toolbar.tsx:12 · e1; a «Customers» · e2]*,",
        "— /other.html —",
        "*[00:01 · button «View orders» · e3]*",
        "— /spa.html —",
        "*[00:01 · button «Reports» · e4]*",
        "que es.",
      ].join("\n\n"),
    );
    expect(md).toContain("- e2: click at 00:01, burst with e1\n");
    expect(md).toContain("- e3: click at 00:01, pause after «esto»\n");
  });

  it("escapes user-derived text everywhere", () => {
    const nasty = element("code", "*star* [x](y)", "div[data-x='`a`']", {
      html: "<code>```js</code>",
      label: "<b>label</b>",
    });
    const events: CapturedEvent[] = [
      {
        id: "e1",
        gesture: "select",
        // Overlaps only "2*3", so the paragraph still starts with "1." (a list, if unescaped).
        tStart: 300,
        tEnd: 350,
        url: "http://localhost:5500/my_page",
        element: nasty,
        selection: { text: "line one\nline _two_" },
      },
    ];
    const words = [w(" 1.", 0, 200), w(" 2*3", 200, 400)];
    const md = renderClassic(session(events, 1000), transcript(words));
    expect(transcriptSection(md)).toBe(
      "— /my\\_page —\n\n1\\. 2\\*3 *[00:00 · code «line one line \\_two\\_» · e1]*",
    );
    expect(md).toContain("### e1 · code «\\*star\\* \\[x\\](y)»");
    expect(md).toContain("; selected «line one line \\_two\\_»");
    expect(md).toContain("- selector: ``div[data-x='`a`']`` (unique)");
    expect(md).toContain("- label: «\\<b\\>label\\</b\\>»");
    expect(md).toContain("````html\n<code>```js</code>\n````");
  });

  it("applies the render budgets", () => {
    const long = element("p", "word ".repeat(100).trim(), "#long", {
      html: `<p>${"word ".repeat(100).trim()}</p>`,
    });
    const words = [w(" Este", 0, 300), w(" párrafo.", 300, 800)];
    const md = renderClassic(session([click("e1", 100, long)], 1000), transcript(words), {
      htmlBudget: 30,
    });
    const marker = /\*\[00:00 · p «[^»]*» · e1\]\*/.exec(md)?.[0] ?? "";
    expect(marker.length).toBeGreaterThan(0);
    expect(marker.length).toBeLessThanOrEqual(80);
    // 30 chars: "<p>" + 19 chars of text + "…" + "</p>" = 27; a fifth word would not fit.
    expect(md).toContain("```html\n<p>word word word word…</p>\n```");
  });

  it("joins bare words from API engines with spaces", () => {
    const words = [w("Esto", 0, 200), w("es", 200, 300), w(",", 300, 300), w("todo.", 300, 600)];
    const md = renderClassic(session([], 1000), transcript(words, "es"));
    expect(transcriptSection(md)).toBe("Esto es, todo.");
  });

  it("renders empty inputs", () => {
    const md = renderClassic(session([], 0), { schemaVersion: 1, engine: "test-engine", words: [] });
    expect(md).toBe(`# pointcast session 2026-09-26\\_18-30-05

2026-09-26 16:30 UTC · 00:00 · 0 events · transcript: test-engine

Pointing gestures appear inline as *[time · element · source · id]*; the Appendix details each element. An id like "e2 ×5" means the same element was pointed at 5 times — the Appendix lists every one. The time becomes a range ("00:26–00:29") when a marker's events span more than 1 s.

## Transcript

_No speech was transcribed._

## Appendix

No elements were pointed at.
`);
  });

  it("renders events without any speech as standalone lines", () => {
    const events = [click("e1", 500, element("button", "Save", "#save"))];
    const md = renderClassic(session(events, 1000), transcript([]));
    expect(transcriptSection(md)).toBe(
      "_No speech was transcribed._\n\n— / —\n\n*[00:00 · button «Save» · e1]*",
    );
    expect(md).toContain("- e1: point at 00:00, standalone (no speech nearby)");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const s = session(SPANISH_EVENTS);
    const t = transcript(SPANISH_WORDS);
    const before = JSON.stringify([s, t]);
    const first = renderClassic(s, t);
    expect(renderClassic(s, t)).toBe(first);
    expect(JSON.stringify([s, t])).toBe(before);
  });

  it("escapes pipes, HTML tags and code fences consistently across marker, appendix and header", () => {
    const nasty = element(
      "td",
      "col | value <b>bold</b> and ```fence```",
      "#nasty",
      {
        label: "a | b",
        html: "<td>col | value <b>bold</b> and ```fence```</td>",
      },
    );
    const words = [w(" esto", 0, 300)];
    const events = [click("e1", 100, nasty)];
    const md = renderClassic(session(events, 1000), transcript(words));
    // No unescaped "<b>" (would open real HTML) outside the fenced code block.
    const withoutFence = md.replace(/```html\n[\s\S]*?\n```/g, "");
    expect(withoutFence).not.toContain("<b>bold</b>");
    // The fenced HTML block's fence is longer than the longest backtick run inside it.
    expect(md).toContain("````html\n<td>col | value <b>bold</b> and ```fence```</td>\n````");
  });

  it("stays fast for a long session: 500 events and 5000 words", () => {
    const words: Word[] = [];
    for (let i = 0; i < 5000; i++) {
      const start = i * 400;
      words.push(w(i % 10 === 0 ? " esto" : " palabra", start, start + 300));
    }
    const events: CapturedEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push(click(`e${i}`, i * 4000 + 100, element("button", `Item ${i}`, `#item-${i}`)));
    }
    const start = Date.now();
    const md = renderClassic(session(events, 2_000_000), transcript(words));
    const elapsedMs = Date.now() - start;
    expect(md.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(8000);
  });
});

describe("renderMarkdown with an unreliable transcript", () => {
  const words: WordsFile = {
    ...transcript([w(" Filtra", 1000, 1300), w(" esto.", 1300, 1700)]),
    unreliable: [{ start: 15_200, end: 30_000 }],
  };
  const NOTE =
    "_Note: the transcript around 00:15–00:30 looked unreliable (the speech-to-text repeated itself or invented words) and was dropped; something said there may be missing._";

  it("says so once, before the requests", () => {
    const markdown = renderMarkdown(session([]), words);
    expect(markdown.split(NOTE)).toHaveLength(2);
    expect(markdown.indexOf(NOTE)).toBeLessThan(markdown.indexOf("## Request 1"));
    expect(markdown.indexOf(NOTE)).toBeGreaterThan(markdown.indexOf("Each request below"));
  });

  it("says so in the classic header", () => {
    const markdown = renderClassic(session([]), words);
    expect(markdown.indexOf(NOTE)).toBeGreaterThan(0);
    expect(markdown.indexOf(NOTE)).toBeLessThan(markdown.indexOf("## Transcript"));
  });

  it("lists every stretch, and a single time for an instant", () => {
    const markdown = renderMarkdown(session([]), {
      ...words,
      unreliable: [{ start: 3_000, end: 3_000 }, { start: 15_200, end: 30_000 }, { start: 62_000, end: 70_500 }],
    });
    expect(markdown).toContain("around 00:03, 00:15–00:30 and 01:02–01:10 looked unreliable");
  });

  it("says nothing when nothing was dropped (and for files written before the field existed)", () => {
    const plain = renderMarkdown(session([]), transcript(words.words));
    expect(renderMarkdown(session([]), { ...words, unreliable: [] })).toBe(plain);
    expect(plain).not.toContain("unreliable");
  });
});

describe("estimateTokens", () => {
  it("is characters / 4, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("renderMarkdown deictics by transcript language", () => {
  it('anchors to French "ceci" when the transcript is French, and leaves it alone otherwise', () => {
    const words = [
      w(" Rends", 0, 400),
      w(" ceci", 400, 800),
      w(" plus", 800, 1100),
      w(" grand.", 1100, 1600),
    ];
    const events = [click("e1", 900, element("h1", "Orders", "#title"))];
    expect(renderClassic(session(events, 2000), transcript(words, "fr"))).toContain(
      "- e1: point at 00:00, deictic «ceci»\n",
    );
    // Same words labelled Spanish: no French deictic, so the event falls back to a word.
    expect(renderClassic(session(events, 2000), transcript(words, "es"))).not.toContain(
      "deictic «ceci»",
    );
  });

  it("lets an explicit fuse.deictics list win over the language", () => {
    const words = [w(" Rends", 0, 400), w(" ceci", 400, 800), w(" grand.", 800, 1600)];
    const events = [click("e1", 500, element("h1", "Orders", "#title"))];
    const md = renderClassic(session(events, 2000), transcript(words, "fr"), {
      fuse: { deictics: ["rends"] },
    });
    expect(md).toContain("deictic «Rends»");
  });
});
