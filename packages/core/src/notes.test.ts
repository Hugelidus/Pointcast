import { describe, expect, it } from "vitest";
import { cleanNote, isTypedSession } from "./notes";
import { renderMarkdown } from "./render";
import { INSTRUCTION_LINES } from "./requests";
import { NOTE_MAX_CHARS, type CapturedEvent, type ElementInfo, type SessionFile, type WordsFile } from "./schema";

function el(tag: string, text: string, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag,
    text,
    selector: `#${text.toLowerCase() || tag}`,
    selectorUnique: true,
    path: `main › ${tag}`,
    html: `<${tag}>${text}</${tag}>`,
    ...extra,
  };
}

function point(id: string, t: number, element: ElementInfo, note?: string): CapturedEvent {
  return { id, gesture: "point", tStart: t, tEnd: t, url: "http://localhost:5173/orders", element, ...(note ? { note } : {}) };
}

function typed(events: CapturedEvent[]): SessionFile {
  return {
    schemaVersion: 2,
    id: "2026-09-28_10-00-00",
    startedAt: "2026-09-28T08:00:00.000Z",
    t0: 1790000000000,
    durationMs: 20000,
    recorder: { extensionVersion: "0.4.0", userAgent: "test" },
    events,
    inputMode: "typed",
  };
}

const EXPORT = el("button", "Export", {
  renderedBy: [{ component: "Toolbar", file: "src/Toolbar.tsx", line: 12 }],
});
const QUANTITY = el("th", "Quantity");

describe("cleanNote", () => {
  it("trims, keeps line breaks and drops what a note never needs", () => {
    expect(cleanNote("  Export only the filtered rows.  \r\n\r\nNot all of them.\u0007  ")).toBe(
      "Export only the filtered rows.\n\nNot all of them.",
    );
    expect(cleanNote("a\tb")).toBe("a\tb");
  });

  it("has one representation for no note", () => {
    for (const blank of ["", "   ", "\n\n", undefined, 42, null]) expect(cleanNote(blank)).toBeUndefined();
  });

  it("caps the length", () => {
    const note = cleanNote("x".repeat(NOTE_MAX_CHARS + 500));
    expect(note).toHaveLength(NOTE_MAX_CHARS);
    expect(note?.endsWith("…")).toBe(true);
  });
});

describe("renderMarkdown of a typed session (D12)", () => {
  it("makes each noted event its own request, the note quoted with the element's letter after it", () => {
    const md = renderMarkdown(
      typed([
        point("e1", 1000, EXPORT, "This button should export only the filtered orders."),
        point("e2", 5000, QUANTITY, "Make this column sortable"),
      ]),
      undefined,
    );
    expect(md).toContain("quotes the note the user typed");
    expect(md).not.toContain("speech-to-text");
    const [, first, second] = md.split(/^## Request \d+$/m);
    expect(first).toContain("> This button should export only the filtered orders. [a]");
    // The element exactly as a voice session renders it: code first, then what it is on screen.
    expect(first).toContain("- [a] «Export» → code:");
    expect(first).toContain("src/Toolbar.tsx:12");
    expect(second).toContain("> Make this column sortable [a]");
    expect(second).toContain("- [a] th «Quantity» on `/orders`");
    expect(md).toContain("## Appendix");
  });

  it("carries the instruction style's line, as a voice session does", () => {
    const events = [point("e1", 1000, EXPORT, "Export only the filtered orders.")];
    const lines = (md: string) => md.split("\n\n")[1]!.split("\n");
    expect(lines(renderMarkdown(typed(events), undefined))[1]).toBe(INSTRUCTION_LINES.intent);
    expect(lines(renderMarkdown({ ...typed(events), instructionStyle: "precise" }, undefined))[1]).toBe(INSTRUCTION_LINES.precise);
    expect(lines(renderMarkdown(typed(events), undefined, { style: "precise" }))[1]).toBe(INSTRUCTION_LINES.precise);
  });

  it("ignores words, even when there are some, and orders the requests by time", () => {
    const words: WordsFile = { schemaVersion: 1, engine: "x", words: [{ text: " this", start: 900, end: 1100 }] };
    const session = typed([point("e2", 5000, QUANTITY, "second"), point("e1", 1000, EXPORT, "first")]);
    const md = renderMarkdown(session, words);
    expect(md).toBe(renderMarkdown(session, undefined));
    expect(md.indexOf("> first [a]")).toBeLessThan(md.indexOf("> second [a]"));
    // No transcript to audit: the classic format renders the same requests.
    expect(renderMarkdown(session, undefined, { format: "classic" })).toBe(md);
  });

  it("groups gestures saved without a note in a row, like pointing without speaking", () => {
    const md = renderMarkdown(
      typed([
        point("e1", 1000, EXPORT),
        point("e2", 2000, QUANTITY),
        point("e3", 3000, el("a", "Help"), "Link to the new docs"),
        point("e4", 4000, el("h1", "Orders")),
      ]),
      undefined,
    );
    expect(md.match(/^## Request/gm)).toHaveLength(3);
    expect(md).toContain("## Request 1\n\n_Pointed at without a note._\n\n- [a] «Export»");
    expect(md).toContain("- [b] th «Quantity»");
    expect(md).toContain("## Request 2\n\n> Link to the new docs [a]");
    expect(md).toContain("## Request 3\n\n_Pointed at without a note._");
  });

  it("quotes every line of a multi-line note and escapes what would read as Markdown", () => {
    const md = renderMarkdown(typed([point("e1", 1000, EXPORT, "# Rename it\n\nuse *bold* [b] labels")]), undefined);
    expect(md).toContain("> \\# Rename it\n>\n> use \\*bold\\* \\[b\\] labels [a]");
  });

  it("refers back to an element described in an earlier request", () => {
    const md = renderMarkdown(typed([point("e1", 1000, QUANTITY, "sortable"), point("e2", 2000, QUANTITY, "wider")]), undefined);
    expect(md).toContain("- [a] th «Quantity» on `/orders` (same element as in request 1)");
  });

  it("says when nothing was pointed at", () => {
    expect(renderMarkdown(typed([]), undefined)).toContain("_Nothing was pointed at._");
  });

  it("treats a session without inputMode as voice", () => {
    expect(isTypedSession({})).toBe(false);
    expect(isTypedSession({ inputMode: "voice" })).toBe(false);
    expect(isTypedSession({ inputMode: "typed" })).toBe(true);
    const { inputMode: _, ...voice } = typed([point("e1", 1000, EXPORT, "ignored in a voice session")]);
    expect(renderMarkdown(voice, undefined)).toContain("_Pointed at without speaking._");
  });
});
