import { describe, expect, it } from "vitest";
import { renderAppendix } from "./appendix";
import type { Placement } from "./fuse";
import type { CapturedEvent, ElementInfo, Word } from "./schema";

const OPTS = { htmlBudget: 300, selectionBudget: 300 };

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: "button",
    text: "Save",
    selector: "#save",
    selectorUnique: true,
    path: "main › button#save",
    html: "<button>Save</button>",
    ...overrides,
  };
}

function ev(id: string, overrides: Partial<CapturedEvent> = {}): CapturedEvent {
  return {
    id,
    gesture: "point",
    tStart: 0,
    tEnd: 0,
    url: "http://localhost:5500/",
    element: element(),
    ...overrides,
  };
}

function placement(eventId: string, overrides: Partial<Placement> = {}): Placement {
  return { eventId, kind: "standalone", wordIndex: -1, ...overrides };
}

describe("renderAppendix", () => {
  it("returns a fixed message for no events", () => {
    expect(renderAppendix([], [], [], OPTS)).toEqual(["No elements were pointed at."]);
  });

  it("lists one entry per unique element, in order of first appearance", () => {
    const a = ev("e1", { element: element({ selector: "#a" }) });
    const b = ev("e2", { element: element({ selector: "#b" }) });
    const aAgain = ev("e3", { element: element({ selector: "#a" }) });
    const blocks = renderAppendix(
      [a, b, aAgain],
      [placement("e1"), placement("e2"), placement("e3")],
      [],
      OPTS,
    );
    const headings = blocks.filter((b) => b.startsWith("### "));
    expect(headings).toEqual(["### e1, e3 · button «Save»", "### e2 · button «Save»"]);
  });

  it("is stable regardless of which duplicate event is first: same grouping, different id list order preserved", () => {
    // Grouping key is selector+url; whichever event of a duplicate pair comes first in the
    // input decides which element's snapshot (text/html/etc) is shown, but every id is listed.
    const first = ev("e1", { element: element({ selector: "#dup", text: "First" }) });
    const second = ev("e2", { element: element({ selector: "#dup", text: "Second" }) });
    const blocks = renderAppendix(
      [first, second],
      [placement("e1"), placement("e2")],
      [],
      OPTS,
    );
    expect(blocks[0]).toBe("### e1, e2 · button «First»");
  });

  it("escapes Markdown-significant characters in text, label, hint and selection", () => {
    const nasty = ev("e1", {
      gesture: "select",
      element: element({
        text: "*bold* [x](y) | pipe `code`",
        label: "<script>alert(1)</script>",
        hint: "col | header",
        context: "Sales *this* week",
        html: "",
      }),
      selection: { text: "line one\nline *two*" },
    });
    const blocks = renderAppendix([nasty], [placement("e1")], [], OPTS);
    const joined = blocks.join("\n");
    expect(joined).toContain("### e1 · button «\\*bold\\* \\[x\\](y) | pipe \\`code\\`»");
    expect(joined).toContain("- label: «\\<script\\>alert(1)\\</script\\>»");
    expect(joined).toContain("- hint: «col | header»");
    expect(joined).toContain("- context: «Sales \\*this\\* week»");
    expect(joined).toContain("selected «line one line \\*two\\*»");
    // No raw, unescaped HTML tag should appear anywhere in the appendix text (only inside a
    // fenced ```html block, which this element does not have since html is "").
    expect(joined).not.toContain("<script>alert(1)</script>");
  });

  it("names the item a short value belongs to", () => {
    const badge = ev("e1", { element: element({ tag: "span", text: "3", context: "Main", itemLabel: "*Messages*" }) });
    const joined = renderAppendix([badge], [placement("e1")], [], OPTS).join("\n");
    expect(joined).toContain("- context: «Main»\n- next to: «\\*Messages\\*»");
  });

  it("escapes a selector containing backticks so the code span still closes correctly", () => {
    const nasty = ev("e1", { element: element({ selector: "div[data-x='`a`']" }) });
    const blocks = renderAppendix([nasty], [placement("e1")], [], OPTS);
    expect(blocks.join("\n")).toContain("- selector: ``div[data-x='`a`']`` (unique)");
  });

  it("keeps newlines out of the heading even with a multi-line text", () => {
    const nasty = ev("e1", { element: element({ text: "line one\nline two\nline three" }) });
    const blocks = renderAppendix([nasty], [placement("e1")], [], OPTS);
    expect(blocks[0].split("\n").length).toBe(1);
    expect(blocks[0]).toBe("### e1 · button «line one line two line three»");
  });

  it("reports selectorUnique correctly for both true and false", () => {
    const unique = ev("e1", { element: element({ selectorUnique: true }) });
    const notUnique = ev("e2", {
      element: element({ selector: "#b", selectorUnique: false }),
    });
    const blocks = renderAppendix(
      [unique, notUnique],
      [placement("e1"), placement("e2")],
      [],
      OPTS,
    );
    const joined = blocks.join("\n");
    expect(joined).toContain("(unique)");
    expect(joined).toContain("(not unique)");
  });

  it("renders selection start/end bounds when the container was too large", () => {
    const start = element({ tag: "li", text: "First item", selector: "#start" });
    const end = element({ tag: "li", text: "Last item", selector: "#end" });
    const withBounds = ev("e1", {
      gesture: "select",
      element: element({ tag: "ul", selector: "#list" }),
      selection: { text: "First item ... Last item", start, end },
    });
    const blocks = renderAppendix([withBounds], [placement("e1")], [], OPTS);
    const joined = blocks.join("\n");
    expect(joined).toContain("- e1 selection starts in: li «First item» `#start`");
    expect(joined).toContain("- e1 selection ends in: li «Last item» `#end`");
  });

  it("marks sensitive elements without leaking any text", () => {
    const sensitive = ev("e1", {
      element: element({ text: "", html: "", sensitive: true }),
    });
    const blocks = renderAppendix([sensitive], [placement("e1")], [], OPTS);
    const joined = blocks.join("\n");
    expect(joined).toContain("- privacy: pointcast did not record this field's value or text");
    // Must read as a statement about pointcast, never as an instruction to the reader.
    expect(joined).not.toContain("mask");
    expect(joined).not.toMatch(/- sensitive:/);
  });

  it("shows the anchoring reason from the placement, including an unplaced event", () => {
    const a = ev("e1");
    const words: Word[] = [{ text: " esto", start: 0, end: 300 }];
    const blocks = renderAppendix(
      [a],
      [placement("e1", { kind: "deictic", wordIndex: 0 })],
      words,
      OPTS,
    );
    expect(blocks.join("\n")).toContain("deictic «esto»");

    const blocksNoPlacement = renderAppendix([a], [], words, OPTS);
    expect(blocksNoPlacement.join("\n")).toContain("not placed");
  });

  it("omits the html fence entirely when html is the empty string", () => {
    const noHtml = ev("e1", { element: element({ html: "" }) });
    const blocks = renderAppendix([noHtml], [placement("e1")], [], OPTS);
    expect(blocks.some((b) => b.includes("```"))).toBe(false);
  });

  // PRIVACY (D8): defense in depth for a session recorded before capture normalized file paths
  // (or edited by hand) — the renderer must not print the machine's home directory or username
  // even when session.json itself still has the absolute path.
  it("never prints a home directory or username from an old session's absolute source path", () => {
    const leaky = ev("e1", {
      element: element({
        source: {
          file: "C:/Users/hugob/Desktop/my-app/src/components/Toolbar.tsx",
          line: 12,
          attribute: "data-source",
          distance: 0,
        },
      }),
    });
    const joined = renderAppendix([leaky], [placement("e1")], [], OPTS).join("\n");
    expect(joined).not.toContain("Users/hugob");
    expect(joined).not.toContain("hugob");
    expect(joined).toContain("- source: `src/components/Toolbar.tsx:12`");
  });
});
