import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";
import type { CapturedEvent, ElementInfo, SessionFile, Word, WordsFile } from "./schema";

/**
 * Sibling runs (D5 note 2026-09-28): the shape of a real recording where one request pointed at
 * the 7 week rows of a progress list, all rendered by one component at one line.
 */

const STYLES = { color: "rgb(17, 24, 39)", "font-size": "14px", display: "flex" };

function week(n: number, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: "li",
    text: `Sem ${n} · ${n * 2} tareas`,
    context: "Progreso",
    selector: `ul > li:nth-of-type(${n - 1})`,
    selectorUnique: true,
    path: `main › section«Progreso» › ul › li[${n - 1}]`,
    html: `<li>Sem ${n} · ${n * 2} tareas</li>`,
    styles: STYLES,
    component: { framework: "react", name: "WeekRow", file: "src/progress/WeekRow.tsx", line: 12 },
    renderedBy: [
      { component: "WeekRow", file: "src/progress/ProgressList.tsx", line: 40, snippet: "<WeekRow key={w.id} week={w} />" },
      { component: "ProgressList", file: "src/pages/Home.tsx", line: 88 },
    ],
    ...extra,
  };
}

function render(elements: ElementInfo[], layout: "code-first" | "dom-first" = "code-first"): string {
  // "Revisa estas semanas, están mal." with every row pointed at on "estas".
  const words: Word[] = ["Revisa", "estas", "semanas,", "están", "mal."].map((text, i) => ({
    text: ` ${text}`,
    start: i * 400,
    end: (i + 1) * 400,
  }));
  const events: CapturedEvent[] = elements.map((element, i) => ({
    id: `e${i + 1}`,
    gesture: "point",
    tStart: 450 + i * 40,
    tEnd: 450 + i * 40,
    url: "http://localhost:5173/",
    element,
  }));
  const session: SessionFile = {
    schemaVersion: 2,
    id: "2026-09-28_10-00-00",
    startedAt: "2026-09-28T08:00:00.000Z",
    t0: 1790000000000,
    durationMs: 10000,
    recorder: { extensionVersion: "0.6.0", userAgent: "test" },
    events,
  };
  const transcript: WordsFile = { schemaVersion: 1, engine: "test-engine", language: "es", words };
  return renderMarkdown(session, transcript, { format: "requests", layout });
}

/** Request 1's quote and elements. */
function request(md: string): string {
  return md.split("## Request 1\n\n")[1].split("\n\n## Appendix")[0];
}

const WEEKS = [2, 3, 4, 5, 6, 7, 8].map((n) => week(n));

describe("sibling runs", () => {
  it("renders 3 or more copies of one component as one entry, with the shared lines once", () => {
    expect(request(render(WEEKS))).toBe(
      [
        "> Revisa estas [a–g] semanas, están mal.",
        "",
        "- [a–g] 7 × «Sem 2 · 4 tareas», «Sem 3 · 6 tareas», «Sem 4 · 8 tareas», «Sem 5 · 10 tareas», «Sem 6 · 12 tareas», «Sem 7 · 14 tareas», «Sem 8 · 16 tareas» → code:",
        "  - used at: `src/progress/ProgressList.tsx:40` — `<WeekRow key={w.id} week={w} />`",
        "  - defined in: `src/progress/WeekRow.tsx`",
        "  - within: `<ProgressList>` at `src/pages/Home.tsx:88`",
        "  - on screen: li in «Progreso» on `/`",
        "  - find: component `WeekRow` (react) in `src/progress/WeekRow.tsx:12`",
        "  - in: `main › section«Progreso» › ul › li[1..7]`",
        "  - styles: `color: rgb(17, 24, 39); font-size: 14px; display: flex`",
      ].join("\n"),
    );
  });

  it("groups in the dom-first layout too", () => {
    expect(request(render(WEEKS.slice(0, 3), "dom-first"))).toBe(
      [
        "> Revisa estas [a–c] semanas, están mal.",
        "",
        "- [a–c] 3 × li «Sem 2 · 4 tareas», «Sem 3 · 6 tareas», «Sem 4 · 8 tareas» in «Progreso» on `/`",
        "  - find: component `WeekRow` (react) in `src/progress/WeekRow.tsx:12`",
        "  - code: `<li>` at `src/progress/WeekRow.tsx:12` ← `<WeekRow>` at `src/progress/ProgressList.tsx:40` ← `<ProgressList>` at `src/pages/Home.tsx:88`",
        "  - in: `main › section«Progreso» › ul › li[1..3]`",
        "  - styles: `color: rgb(17, 24, 39); font-size: 14px; display: flex`",
      ].join("\n"),
    );
  });

  it("explains the entry in the preamble, only when there is one", () => {
    const explained = 'An entry like "[c–e] 3 × «A», «B», «C»" stands for elements c, d and e';
    expect(render(WEEKS).split("## Request 1")[0]).toContain(explained);
    expect(render(WEEKS.slice(0, 2))).not.toContain(explained);
  });

  it("does not group 2", () => {
    const md = request(render(WEEKS.slice(0, 2)));
    expect(md).toContain("> Revisa estas [a, b] semanas, están mal.");
    expect(md).toContain("- [a] «Sem 2 · 4 tareas» → code:");
    expect(md).toContain("- [b] «Sem 3 · 6 tareas» → code:");
  });

  it("does not group elements whose text is written in different places", () => {
    const resolved = (line: number) => [{ kind: "data" as const, file: "src/progress/weeks.ts", line, via: "repo" as const }];
    const md = request(render([week(2, { resolved: resolved(3) }), week(3, { resolved: resolved(4) }), week(4, { resolved: resolved(5) })]));
    expect(md.match(/^- \[[a-c]\] /gm)).toHaveLength(3);
    // The same data line for all: grouped, with it once.
    const same = request(render([2, 3, 4].map((n) => week(n, { resolved: resolved(3) }))));
    expect(same).toContain("- [a–c] 3 × ");
    expect(same.match(/data at: /g)).toHaveLength(1);
  });

  it("does not group elements with different styles, cards or components", () => {
    for (const odd of [
      week(4, { styles: { ...STYLES, color: "red" } }),
      week(4, { context: "Otra tarjeta" }),
      week(4, { renderedBy: [{ component: "OtherRow", file: "src/progress/ProgressList.tsx", line: 41 }] }),
      week(4, { path: "main › section«Progreso» › ol › li[3]" }),
    ]) {
      expect(request(render([week(2), week(3), odd]))).not.toContain("3 × ");
    }
  });

  it("does not group elements without code information", () => {
    const plain = WEEKS.map(({ component: _c, renderedBy: _r, ...rest }) => rest);
    expect(request(render(plain))).not.toContain(" × ");
  });

  it("groups the longest run and renders the rest alone, with the quote's letters still matching", () => {
    const md = request(render([week(2, { context: "Resumen" }), ...WEEKS.slice(1, 5)]));
    expect(md).toContain("> Revisa estas [a, b–e] semanas, están mal.");
    expect(md).toContain("- [a] «Sem 2 · 4 tareas» → code:");
    expect(md).toContain("- [b–e] 4 × «Sem 3 · 6 tareas», «Sem 4 · 8 tareas», «Sem 5 · 10 tareas», «Sem 6 · 12 tareas» → code:");
    expect(md).toContain("  - in: `main › section«Progreso» › ul › li[2..5]`");
  });

  it("lists per element a line that differs by more than the text and numbers, once one that does not", () => {
    // The HTML is shown when it adds information: here, children.
    const html = (n: number, state: string) => week(n, { html: `<li><span>Sem ${n}</span><b>${state}</b></li>` });
    const differing = request(render([html(2, "hecha"), html(3, "tarde"), html(4, "hecha")]));
    expect(differing).toContain("- [a–c] 3 × ");
    expect(differing).toContain(
      [
        "  - [a] html: `<li><span>Sem 2</span><b>hecha</b></li>`",
        "  - [b] html: `<li><span>Sem 3</span><b>tarde</b></li>`",
        "  - [c] html: `<li><span>Sem 4</span><b>hecha</b></li>`",
      ].join("\n"),
    );
    const alike = request(render([html(2, "hecha"), html(3, "hecha"), html(4, "hecha")]));
    expect(alike).toContain("  - [a] html: `<li><span>Sem 2</span><b>hecha</b></li>`");
    expect(alike).not.toContain("[b] html:");
  });
});
