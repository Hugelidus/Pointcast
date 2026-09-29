import { describe, expect, it } from "vitest";
import {
  elementKey,
  eventText,
  formatClock,
  fullSource,
  isShortValue,
  shortSource,
  urlLabel,
} from "./describe";
import { renderMarker } from "./marker";
import type { CapturedEvent } from "./schema";
import { isPunctuationOnly, splitWord, usesLeadingSpaces } from "./word-text";

function event(overrides: Partial<CapturedEvent> = {}): CapturedEvent {
  return {
    id: "e1",
    gesture: "point",
    tStart: 4000,
    tEnd: 4000,
    url: "http://localhost:5500/",
    element: {
      tag: "th",
      text: "Quantity",
      selector: "#orders-table th:nth-of-type(3)",
      selectorUnique: true,
      path: "main › table › th[3]",
      html: "<th>Quantity</th>",
    },
    ...overrides,
  };
}

describe("formatClock", () => {
  it.each([
    [0, "00:00"],
    [4410, "00:04"],
    [61_000, "01:01"],
    [3_665_000, "61:05"],
    [-20, "00:00"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });
});

describe("urlLabel", () => {
  it.each([
    ["http://localhost:5500/", "/"],
    ["http://localhost:5500", "/"],
    ["http://localhost:5500/orders?page=2#top", "/orders?page=2"],
    ["http://app.localhost/#/orders", "/#/orders"],
    ["http://app.localhost/#!/orders", "/#!/orders"],
    ["not a url", "not a url"],
  ])("%s -> %s", (url, expected) => {
    expect(urlLabel(url)).toBe(expected);
  });
});

describe("elementKey", () => {
  it("is equal for the same selector on the same page, ignoring scroll fragments", () => {
    const a = event({ url: "http://localhost:5500/orders#top" });
    const b = event({ id: "e2", url: "http://localhost:5500/orders" });
    expect(elementKey(a)).toBe(elementKey(b));
  });

  it("differs for the same selector on another page", () => {
    const a = event({ url: "http://localhost:5500/orders" });
    const b = event({ url: "http://localhost:5500/users" });
    expect(elementKey(a)).not.toBe(elementKey(b));
  });

  it("differs for the same selector and page when the path, the card or the code differ", () => {
    // Two charts, one per tab panel, share their selector and URL (D5 note 2026-09-29).
    const chart = (path: string, extra: Partial<CapturedEvent["element"]> = {}) =>
      event({ element: { tag: "div", text: "", selector: "div.chart-wrapper", selectorUnique: false, path, html: "<div></div>", ...extra } });
    const first = chart("main › div[role=tabpanel][2] › div");
    expect(elementKey(first)).not.toBe(elementKey(chart("main › div[role=tabpanel][3] › div")));
    expect(elementKey(first)).not.toBe(elementKey(chart(first.element.path, { context: "Ingresos" })));
    const frame = { component: "SalesChart", file: "src/Sales.tsx", line: 12 };
    const drawn = chart(first.element.path, { renderedBy: [frame] });
    expect(elementKey(drawn)).not.toBe(elementKey(chart(first.element.path, { renderedBy: [{ ...frame, line: 30 }] })));
    expect(elementKey(drawn)).toBe(elementKey(chart(first.element.path, { renderedBy: [{ ...frame }] })));
  });
});

describe("eventText", () => {
  it("prefers the selected text for selections, then text, then label", () => {
    expect(eventText(event({ gesture: "select", selection: { text: "Qua" } }))).toBe("Qua");
    expect(eventText(event())).toBe("Quantity");
    const icon = event({ element: { ...event().element, text: "", label: "Close" } });
    expect(eventText(icon)).toBe("Close");
  });
});

describe("isShortValue", () => {
  it("is a value with no run of two letters: counters, amounts, marks", () => {
    for (const value of ["3", "12", "+5", "99+", "$4", "•", "✓", " 2+ ", "3d", "A-1"]) expect(isShortValue(value), value).toBe(true);
    for (const text of ["", "  ", "Messages", "3 new", "Ñu", "12 días"]) expect(isShortValue(text), text).toBe(false);
  });
});

describe("source formatting", () => {
  const source = {
    file: "src/components/Toolbar.tsx",
    line: 12,
    column: 5,
    attribute: "data-source",
    distance: 1,
  };

  it("short form is basename:line", () => {
    expect(shortSource(source)).toBe("Toolbar.tsx:12");
    expect(shortSource({ ...source, line: undefined })).toBe("Toolbar.tsx");
    expect(shortSource({ ...source, file: "src\\App.vue" })).toBe("App.vue:12");
  });

  it("full form keeps the path, line and column", () => {
    expect(fullSource(source)).toBe("src/components/Toolbar.tsx:12:5");
    expect(fullSource({ ...source, column: undefined })).toBe("src/components/Toolbar.tsx:12");
  });

  // PRIVACY (D8): defense in depth — fullSource normalizes even a file that was never
  // normalized at capture (an older session, or one edited by hand).
  it("full form normalizes an absolute file to a project-relative path", () => {
    expect(fullSource({ ...source, file: "C:/Users/hugob/project/src/components/Toolbar.tsx" })).toBe(
      "src/components/Toolbar.tsx:12:5",
    );
  });
});

describe("word tokens", () => {
  it("splits lead, core and trailing punctuation", () => {
    expect(splitWord(" Esto,")).toEqual({ lead: " ", core: "Esto", trailing: "," });
    expect(splitWord("filtrado.")).toEqual({ lead: "", core: "filtrado", trailing: "." });
    expect(splitWord(" (esto)")).toEqual({ lead: " ", core: "(esto", trailing: ")" });
    expect(splitWord(" ...")).toEqual({ lead: " ", core: "...", trailing: "" });
    expect(splitWord("¿Qué?!")).toEqual({ lead: "", core: "¿Qué", trailing: "?!" });
  });

  it("detects whether the engine marks word starts with spaces", () => {
    const w = (text: string) => ({ text, start: 0, end: 0 });
    expect(usesLeadingSpaces([w(" Hola"), w(" mundo")])).toBe(true);
    expect(usesLeadingSpaces([w("Hola"), w("mundo")])).toBe(false);
    expect(usesLeadingSpaces([])).toBe(false);
  });

  it("recognizes punctuation-only tokens", () => {
    expect(isPunctuationOnly(",")).toBe(true);
    expect(isPunctuationOnly(" ...")).toBe(true);
    expect(isPunctuationOnly("a.")).toBe(false);
  });
});

describe("renderMarker", () => {
  it("renders time, descriptor and id", () => {
    expect(renderMarker([event()], 80)).toBe("*[00:04 · th «Quantity» · e1]*");
  });

  it("adds the short source when known", () => {
    const withSource = event({
      element: {
        ...event().element,
        tag: "button",
        text: "Export",
        source: { file: "src/Toolbar.tsx", line: 12, attribute: "data-source", distance: 0 },
      },
    });
    expect(renderMarker([withSource], 80)).toBe("*[00:04 · button «Export» · Toolbar.tsx:12 · e1]*");
  });

  it("merges several elements into one bracket and repeated elements into one part with a repeat count", () => {
    const e2 = event({
      id: "e2",
      tStart: 5000,
      tEnd: 5000,
      element: { ...event().element, text: "Price", selector: "#price" },
    });
    const e3 = event({ id: "e3", tStart: 6000, tEnd: 6000 });
    // e1 and e3 are the same element (default selector): shown once as "e1 ×2", not "e1, e3".
    // Events span 4000..6000 ms (2 s > 1 s), so the clock becomes a range too.
    expect(renderMarker([event(), e2, e3], 80)).toBe(
      "*[00:04–00:06 · th «Quantity» · e1 ×2; th «Price» · e2]*",
    );
  });

  it("keeps a single mm:ss clock when a merged marker's events span 1 s or less", () => {
    const e2 = event({ id: "e2", tStart: 4500, element: { ...event().element, text: "Price", selector: "#price" } });
    expect(renderMarker([event(), e2], 80)).toBe("*[00:04 · th «Quantity» · e1; th «Price» · e2]*");
  });

  it("shows a range from the earliest start to the latest end when events span more than 1 s", () => {
    const e2 = event({ id: "e2", tStart: 5500, tEnd: 5500 });
    // Same element as e1 (default selector), so this also covers the ×N + range combination.
    expect(renderMarker([event(), e2], 80)).toBe("*[00:04–00:05 · th «Quantity» · e1 ×2]*");
  });

  it("trims the quoted text so a single marker stays within the budget", () => {
    const long = event({ element: { ...event().element, tag: "p", text: "word ".repeat(40) } });
    const marker = renderMarker([long], 80);
    expect(marker.length).toBeLessThanOrEqual(80);
    expect(marker).toMatch(/^\*\[00:04 · p «word word .*…» · e1\]\*$/);
  });

  it("falls back to the tag alone when there is no text or label", () => {
    const bare = event({ element: { ...event().element, tag: "div", text: "" } });
    expect(renderMarker([bare], 80)).toBe("*[00:04 · div · e1]*");
  });

  it("escapes Markdown in element text and collapses newlines", () => {
    const nasty = event({ element: { ...event().element, text: "*bold* [x]\n`y`" } });
    expect(renderMarker([nasty], 80)).toBe("*[00:04 · th «\\*bold\\* \\[x\\] \\`y\\`» · e1]*");
  });
});
