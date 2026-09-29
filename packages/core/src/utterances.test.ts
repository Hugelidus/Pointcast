import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";
import type { CapturedEvent, ElementInfo, SessionFile, Word, WordsFile } from "./schema";

/**
 * Synthetic reproductions of the split requests seen in a real 10-minute voice recording
 * (D4 note 2026-09-28): the times are the shape of the real ones, the words and elements generic.
 */

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

/** Words said one after another from `start`, 300 ms each. */
function said(text: string, start: number): Word[] {
  return text.split(" ").map((word, i) => w(` ${word}`, start + i * 300, start + (i + 1) * 300));
}

function el(tag: string, text: string, n = 1): ElementInfo {
  return {
    tag,
    text,
    selector: `${tag}:nth-of-type(${n})`,
    selectorUnique: true,
    path: `main › ${tag}[${n}]`,
    html: `<${tag}>${text}</${tag}>`,
  };
}

function point(id: string, t: number, element: ElementInfo): CapturedEvent {
  return { id, gesture: "point", tStart: t, tEnd: t, url: "http://localhost:5173/", element };
}

function render(events: CapturedEvent[], words: Word[]): string {
  const session: SessionFile = {
    schemaVersion: 2,
    id: "2026-09-28_10-00-00",
    startedAt: "2026-09-28T08:00:00.000Z",
    t0: 1790000000000,
    durationMs: 60000,
    recorder: { extensionVersion: "0.6.0", userAgent: "test" },
    events,
  };
  const transcript: WordsFile = { schemaVersion: 1, engine: "test-engine", language: "es", words };
  return renderMarkdown(session, transcript, { format: "requests" });
}

/** The quote lines and element heads of each request, in order. */
function requests(md: string): string[][] {
  return md
    .split(/^## Request \d+$/m)
    .slice(1)
    .map((block) =>
      block
        .split("## Appendix")[0]
        .split("\n")
        .filter((line) => line.startsWith(">") || line.startsWith("- ") || line.startsWith("_")),
    );
}

const CHIPS = ["Todos", "Activos", "Pausados", "Archivados", "Más"].map((text, i) => el("button", text, i + 1));

describe("an utterance said without pointing joins its request (mergeUtterances)", () => {
  // Request 1 then 2 in the recording: the intent came right after the pointing.
  const chipWords = (gap: number) => {
    const first = said("Vale, vamos a revisar estos chips de aquí.", 0); // 8 words, 0–2400
    const second = said("no me gustan, la verdad es que los cambiaría", 2400 + gap);
    return [...first, ...second];
  };
  const chipEvents = () => [
    ...CHIPS.slice(0, 4).map((chip, i) => point(`e${i + 1}`, 1300 + i * 100, chip)), // on "estos"
    point("e5", 2200, CHIPS[4]), // on "aquí."
  ];

  it("(b) appends a follow-up to the request with gestures it continues", () => {
    expect(requests(render(chipEvents(), chipWords(1200)))).toEqual([
      [
        "> Vale, vamos a revisar estos [a, b, c, d] chips de aquí [e]. no me gustan, la verdad es que los cambiaría",
        "- [a] button «Todos» on `/`",
        "- [b] button «Activos» on `/`",
        "- [c] button «Pausados» on `/`",
        "- [d] button «Archivados» on `/`",
        "- [e] button «Más» on `/`",
      ],
    ]);
  });

  it("(b) not after a long gap", () => {
    const quotes = requests(render(chipEvents(), chipWords(4500))).map((lines) => lines[0]);
    expect(quotes).toEqual([
      "> Vale, vamos a revisar estos [a, b, c, d] chips de aquí [e].",
      "> no me gustan, la verdad es que los cambiaría",
    ]);
  });

  it("(b) not for a long utterance, which says more than a follow-up does", () => {
    const words = [
      ...said("Vale, vamos a revisar estos chips de aquí.", 0),
      ...said(
        "y luego en otra pantalla hay que cambiar el orden de las columnas y quitar la de fecha porque nadie la usa nunca",
        3000,
      ),
    ];
    expect(requests(render(chipEvents(), words))).toHaveLength(2);
  });

  // Requests 11 and 12 in the recording: a pointing in a silence, then what to do with it.
  const saveButton = el("button", "Guardar");
  const silentWords = (gap: number) => [
    ...said("Esto está bien.", 0), // 0–900
    ...said("y hay que arreglar el botón de guardar que no funciona.", 5000 + gap),
  ];
  const silentEvents = () => [point("e1", 100, el("h1", "Pedidos")), point("e2", 5000, saveButton)];

  it("(a) gives a pointing without speaking the utterance that follows it", () => {
    expect(requests(render(silentEvents(), silentWords(2500)))).toEqual([
      ["> Esto [a] está bien.", "- [a] h1 «Pedidos» on `/`"],
      ["> [a] y hay que arreglar el botón de guardar que no funciona.", "- [a] button «Guardar» on `/`"],
    ]);
  });

  it("(a) not when the utterance starts long after the pointing", () => {
    expect(requests(render(silentEvents(), silentWords(7000)))).toEqual([
      ["> Esto [a] está bien.", "- [a] h1 «Pedidos» on `/`"],
      ["_Pointed at without speaking._", "- [a] button «Guardar» on `/`"],
      ["> y hay que arreglar el botón de guardar que no funciona."],
    ]);
  });

  it("with a gesture in between, the utterance goes with that gesture, not with the request before it", () => {
    // "Esto" [a] … a pointing alone in a 3.4 s silence … then the utterance.
    const words = [...said("Esto está bien.", 0), ...said("y hay que arreglar el botón", 4300)];
    const md = render([point("e1", 100, el("h1", "Pedidos")), point("e2", 2600, saveButton)], words);
    expect(requests(md).map((lines) => lines[0])).toEqual([
      "> Esto [a] está bien.",
      "> [a] y hay que arreglar el botón",
    ]);
  });

  // Requests 9 and 10 in the recording: a lead-in cut by a pause.
  const achievements = el("section", "Logros");
  const leadInWords = (leadIn: string, gap: number) => {
    const first = said(leadIn, 0);
    return [...first, ...said("aquí me gustaría meter más filtros.", first.at(-1)!.end + gap)];
  };

  it("(c) prepends a short lead-in to the request with gestures after it", () => {
    const words = leadInWords("Luego en Pedidos,", 2500);
    expect(requests(render([point("e1", words[3].start + 50, achievements)], words))).toEqual([
      ["> Luego en Pedidos, aquí [a] me gustaría meter más filtros.", "- [a] section «Logros» on `/`"],
    ]);
  });

  it("(c) not for a finished sentence, a long lead-in or a long pause", () => {
    for (const words of [
      leadInWords("Luego en Pedidos.", 2500),
      leadInWords("Luego vamos a ir a la pantalla de Pedidos,", 2500),
      leadInWords("Luego en Pedidos,", 4500),
    ]) {
      const at = words.findIndex((word) => word.text === " aquí");
      expect(requests(render([point("e1", words[at].start + 50, achievements)], words))).toHaveLength(2);
    }
  });

  it("takes at most one utterance per request, and keeps request numbers and back-references right", () => {
    const words = [
      ...said("Cambia estos chips.", 0), // 0–900, pointed
      ...said("no me gustan.", 1500), // (b): joins request 1
      ...said("Y los colores tampoco.", 3000), // a request takes one utterance: its own
      ...said("Y este otra vez.", 8000), // pointed again at the first chip
    ];
    const md = render([point("e1", 400, CHIPS[0]), point("e2", 8400, CHIPS[0])], words);
    expect(md.match(/^## Request \d+$/gm)).toEqual(["## Request 1", "## Request 2", "## Request 3"]);
    expect(requests(md)).toEqual([
      ["> Cambia estos [a] chips. no me gustan.", "- [a] button «Todos» on `/`"],
      ["> Y los colores tampoco."],
      ["> Y este [a] otra vez.", "- [a] button «Todos» on `/` (same element as in request 1)"],
    ]);
  });

  it("keeps the noun lookups in the gesture's own sentence", () => {
    const table = { ...el("td", "42"), path: "main › table#orders › tbody › tr[2] › td[3]" };
    const words = [...said("Haz esta más compacta.", 0), ...said("la tabla entera", 1500)];
    const md = render([point("e1", 400, table)], words);
    expect(md).toContain("> Haz esta [a] más compacta. la tabla entera\n");
    // «tabla» is in the appended utterance, not in the gesture's sentence: no noun line.
    expect(md).not.toContain("said «tabla»");
  });
});

describe("a gesture just before speech joins the request said after it (mergeUtterances, d)", () => {
  // A real 40 s recording (D4 note 2026-09-29): 5.4 s of silence after a sentence, a pointing
  // 155 ms before the next one, "y la tarjeta de pedidos [b] hay que …", and a second pointing in it.
  const card = el("h3", "Pedidos");
  const total = el("span", "+12");
  const words = [...said("esto me gustaría que fuera más claro.", 24600), ...said("y la tarjeta de pedidos hay que cambiarla", 36100)];
  const events = (before: number) => [
    point("e1", 24900, el("div", "Resumen")),
    point("e2", 36100 - before, card),
    point("e3", 37450, total), // on "pedidos"
  ];

  it("marks it before the first word of that request, with the gesture made while speaking", () => {
    expect(requests(render(events(155), words))).toEqual([
      ["> esto [a] me gustaría que fuera más claro.", "- [a] div «Resumen» on `/`"],
      ["> [a] y la tarjeta de pedidos [b] hay que cambiarla", "- [a] h3 «Pedidos» on `/`", "- [b] span «+12» on `/`"],
    ]);
  });

  it("joins up to GESTURE_LEAD_IN_MS before the first word, and not a moment more", () => {
    expect(requests(render(events(1000), words))).toHaveLength(2);
    expect(requests(render(events(1001), words))).toEqual([
      ["> esto [a] me gustaría que fuera más claro.", "- [a] div «Resumen» on `/`"],
      ["_Pointed at without speaking._", "- [a] h3 «Pedidos» on `/`"],
      ["> y la tarjeta de pedidos [a] hay que cambiarla", "- [a] span «+12» on `/`"],
    ]);
  });

  it("keeps a pointing alone when one of its gestures came earlier in the silence", () => {
    const md = render([...events(155), point("e4", 33000, el("button", "Abrir"))], words);
    expect(requests(md).map((lines) => lines[0])).toEqual([
      "> esto [a] me gustaría que fuera más claro.",
      "_Pointed at without speaking._",
      "> y la tarjeta de pedidos [a] hay que cambiarla",
    ]);
  });

  it("still lets the request take a follow-up utterance, by (b)", () => {
    const more = [...words, ...said("no me convence.", 39000)];
    expect(requests(render(events(155), more))[1][0]).toBe("> [a] y la tarjeta de pedidos [b] hay que cambiarla no me convence.");
  });
});
