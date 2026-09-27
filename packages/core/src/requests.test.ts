import { describe, expect, it } from "vitest";
import fixtureSession from "../../../fixtures/sessions/e2e-es/session.json";
import fixtureWords from "../../../fixtures/sessions/e2e-es/words.json";
import { renderMarkdown } from "./render";
import type { CapturedEvent, ElementInfo, SessionFile, Word, WordsFile } from "./schema";

/** The real e2e session (recorded by the extension, transcribed by Whisper base). */
const E2E_SESSION = fixtureSession as unknown as SessionFile;
const E2E_WORDS = fixtureWords as unknown as WordsFile;

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function el(tag: string, text: string, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag,
    text,
    selector: `${tag}:nth-of-type(2)`,
    selectorUnique: true,
    path: `main › ${tag}`,
    html: `<${tag}>${text}</${tag}>`,
    ...extra,
  };
}

function point(id: string, t: number, element: ElementInfo, url = "http://localhost:5173/settings"): CapturedEvent {
  return { id, gesture: "point", tStart: t, tEnd: t, url, element };
}

function session(events: CapturedEvent[], durationMs = 20000): SessionFile {
  return {
    schemaVersion: 2,
    id: "2026-09-27_10-00-00",
    startedAt: "2026-09-27T08:00:00.000Z",
    t0: 1790000000000,
    durationMs,
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events,
  };
}

function transcript(words: Word[], language = "es"): WordsFile {
  return { schemaVersion: 1, engine: "test-engine", language, words };
}

const requests = (s: SessionFile, words: WordsFile) => renderMarkdown(s, words, { format: "requests" });

describe('renderMarkdown format "requests"', () => {
  it("renders the real e2e-es session", async () => {
    const md = requests(E2E_SESSION, E2E_WORDS);
    await expect(md).toMatchFileSnapshot("__snapshots__/e2e-es.requests.md");
  });

  it("keeps the classic format byte-identical, and requests is the default", async () => {
    const s = E2E_SESSION;
    const words = E2E_WORDS;
    await expect(renderMarkdown(s, words, { format: "classic" })).toMatchFileSnapshot("__snapshots__/e2e-es.classic.md");
    expect(renderMarkdown(s, words)).toBe(requests(s, words));
  });

  it("splits sentences and adds noun ancestors, misheard names, styles and components", () => {
    const CELL = el("td", "42", {
      path: "main › section#orders › table#orders › tbody › tr[2] › td[3]",
      selector: "tr:nth-of-type(2) > td:nth-of-type(3)",
      styles: { color: "rgb(17, 24, 39)", "font-size": "14px", margin: "0px" },
    });
    const TOKEN = el("input", "", {
      label: "API token",
      path: "main › form«Settings» › input#api-token",
      selector: "#api-token",
      html: '<input id="api-token" name="apiToken" type="text" aria-label="API token">',
      component: { framework: "react", name: "SettingsForm", file: "src/Settings.tsx", line: 30 },
    });
    const TOGGLE = el("button", "", {
      path: "main › form«Settings» › button[2]",
      selector: "form > button:nth-of-type(2)",
      html: '<button role="switch" aria-checked="true"><svg/></button>',
    });
    const words = [
      w(" Haz", 0, 300),
      w(" esta", 300, 600),
      w(" tabla", 600, 900),
      w(" más", 900, 1100),
      w(" compacta", 1100, 1600),
      // 2.4 s pause without punctuation: still a new sentence.
      w(" Y", 4000, 4200),
      w(" el", 4200, 4300),
      w(" campo", 4300, 4700),
      w(" app", 4700, 5000),
      w(" y", 5000, 5100),
      w(" token,", 5100, 5500),
      w(" esto,", 5600, 6000),
      w(" que", 6000, 6200),
      w(" sea", 6200, 6400),
      w(" obligatorio.", 6400, 7200),
    ];
    const events = [
      point("e1", 400, CELL, "http://localhost:5173/orders"),
      point("e2", 5700, TOKEN),
      // After speech ended: a request of its own, and the table cell again.
      point("e3", 14000, TOGGLE),
      point("e4", 14500, CELL, "http://localhost:5173/orders"),
    ];
    expect(requests(session(events), transcript(words))).toBe(`# UI change requests

Each request below quotes what the user said (speech-to-text, so words may be misheard) and lists the page elements they pointed at while saying it; [a], [b]… in the quote mark the moment they pointed.
Change only the referenced elements, and only as asked. If something is ambiguous, ask before editing.

## Request 1

> Haz esta [a] tabla más compacta

- [a] td «42» on \`/orders\`
  - in: \`main › section#orders › table#orders › tbody › tr[2] › td[3]\`
  - styles: \`color: rgb(17, 24, 39); font-size: 14px\`
  - said «tabla»: \`main › section#orders › table#orders\`

## Request 2

> Y el campo app y token, esto [a], que sea obligatorio.

- [a] input «API token» on \`/settings\`
  - find: \`#api-token\` · name \`apiToken\` · component \`SettingsForm\` (react) in \`src/Settings.tsx:30\`
  - in: \`main › form«Settings» › input#api-token\`
  - heard «app y token», probably «API token»

## Request 3

_Pointed at without speaking._

- [a] button on \`/settings\`
  - in: \`main › form«Settings» › button[2]\`
  - selector: \`form > button:nth-of-type(2)\`
  - html: \`<button role="switch" aria-checked="true"><svg/></button>\`
- [b] td «42» on \`/orders\` (same element as in request 1)

## Appendix

Pages by full URL: \`http://localhost:5173/orders\` · \`http://localhost:5173/settings\`
`);
  });

  it("points a column at its table, notes partial selections and plain clicks", () => {
    const HEADER = el("th", "Quantity", {
      path: "main › table#orders › thead › tr › th[3]",
    });
    const LINK = el("a", "Customers", { html: '<a href="/customers">Customers</a>' });
    const PARAGRAPH = el("p", "Notes are kept for 30 days.");
    const words = [
      w(" Ordena", 0, 400),
      w(" esta", 400, 700),
      w(" columna.", 700, 1200),
      w(" Cambia", 1300, 1600),
      w(" esto", 1600, 1900),
      w(" y", 1900, 2000),
      w(" aquí.", 2000, 2400),
    ];
    const events: CapturedEvent[] = [
      point("e1", 500, HEADER),
      { ...point("e2", 1700, PARAGRAPH), gesture: "select", tEnd: 1800, selection: { text: "30 days" } },
      { ...point("e3", 2100, LINK), gesture: "click" },
    ];
    const md = requests(session(events), transcript(words));
    expect(md).toContain("> Ordena esta [a] columna.\n");
    expect(md).toContain(
      "  - said «columna»: column 3 of `main › table#orders` (its header and the cell at that position in every row)\n",
    );
    expect(md).toContain("> Cambia esto [a] y aquí [b].\n");
    expect(md).toContain("- [a] p «Notes are kept for 30 days.» (selected «30 days») on `/settings`\n");
    expect(md).toContain("- [b] a «Customers» (plain click) on `/settings`\n  - find: href `/customers`\n");
  });

  it("names the card around each element, which tells apart two instances of one component", () => {
    // The eval's flowbite case: two cards render the same shared link.
    const component = { framework: "svelte", name: "More", file: "src/lib/More.svelte" };
    const more = (context: string) => el("a", "Sales Report", { context, selector: `a[data-card="${context}"]`, path: "main › a", component });
    const words = [w(" Este", 0, 300), w(" enlace", 300, 700), w(" y", 700, 900), w(" este.", 900, 1300)];
    const md = requests(
      session([point("e1", 100, more("$45,385 · Sales this week")), point("e2", 1000, more("Sales by category · Desktop PC"))]),
      transcript(words),
    );
    expect(md).toContain("- [a] a «Sales Report» in «$45,385 · Sales this week» on `/settings`\n");
    expect(md).toContain("- [b] a «Sales Report» in «Sales by category · Desktop PC» on `/settings`\n");
  });

  it("says which item a short value belongs to, in both layouts", () => {
    // The Messages badge of examples/react-dashboard, as captured and resolved.
    const badge = el("span", "3", {
      context: "Main",
      itemLabel: "Messages",
      renderedBy: [{ component: "Sidebar", file: "src/App.tsx" }],
      resolved: [{ kind: "data", file: "src/data/nav.ts", line: 16, via: "dev-server" }],
    });
    const words = [w(" Esto", 0, 300), w(" dice", 300, 600), w(" tres.", 600, 1000)];
    const s = session([point("e1", 100, badge)]);
    expect(requests(s, transcript(words))).toContain("  - on screen: span «3» next to «Messages» in «Main» on `/settings`\n");
    expect(renderMarkdown(s, transcript(words), { format: "requests", layout: "dom-first" })).toContain(
      "- [a] span «3» next to «Messages» in «Main» on `/settings`\n",
    );
  });

  it("puts a selection made as a sentence starts in that sentence's request (eval, shadcn-admin)", () => {
    // Whisper's times from the eval recording; the selection starts 106 ms into "Y".
    const words = [
      w(" este", 21130, 21350), w(" número", 21350, 21590), w(" no", 21590, 21790), w(" hace", 21790, 22130),
      w(" falta,", 22130, 22670), w(" fuera.", 22950, 24910), w(" Y", 25530, 25650), w(" el", 25650, 25910),
      w(" texto", 25910, 26090), w(" de", 26090, 26290), w(" ventas", 26290, 26670), w(" recientes.", 26670, 27470),
    ];
    const subtitle = el("div", "You made 265 sales this month.");
    const md = requests(
      session([{ ...point("e1", 25636, subtitle), gesture: "select", tEnd: 25677, selection: { text: subtitle.text } }]),
      transcript(words),
    );
    expect(md).toContain("> este número no hace falta, fuera.\n");
    expect(md).toContain("> Y [a] el texto de ventas recientes.\n\n- [a] div «You made 265 sales this month.» (selected)");
  });

  it("has no timestamps, ids or engine data", () => {
    const md = requests(E2E_SESSION, E2E_WORDS);
    expect(md).not.toMatch(/\d\d:\d\d|\be\d+\b|whisper|2026-09/i);
  });

  it("handles a session with nothing said or pointed at", () => {
    expect(requests(session([]), transcript([]))).toContain("_Nothing was said or pointed at._\n");
  });

  it("gives events recorded with no speech a request of their own", () => {
    const md = requests(session([point("e1", 100, el("h1", "Settings"))]), transcript([]));
    expect(md).toContain("## Request 1\n\n_Pointed at without speaking._\n\n- [a] h1 «Settings» on `/settings`\n");
  });
});
