import { describe, expect, it } from "vitest";
import type { CapturedEvent, ElementInfo } from "@pointcast/core";
import { MAX_ELEMENT_SUMMARY, summarizeEvent } from "./event-summary";

function element(fields: Partial<ElementInfo>): ElementInfo {
  return { tag: "button", text: "", selector: "x", selectorUnique: true, path: "x", html: "<x>", ...fields };
}

const event = (gesture: CapturedEvent["gesture"], fields: Partial<ElementInfo>, selection?: CapturedEvent["selection"]) => ({
  gesture,
  element: element(fields),
  ...(selection ? { selection } : {}),
});

describe("summarizeEvent", () => {
  it("names the tag, the text and the gesture", () => {
    expect(summarizeEvent(event("point", { text: "Export" }))).toBe("button «Export» · Alt+click");
    expect(summarizeEvent(event("click", { tag: "a", text: "Customers" }))).toBe("a «Customers» · click");
  });

  it("uses the label when there is no text, and the bare tag when there is neither", () => {
    expect(summarizeEvent(event("point", { text: "", label: "Close dialog" }))).toBe("button «Close dialog» · Alt+click");
    expect(summarizeEvent(event("click", { tag: "div", text: "" }))).toBe("div · click");
  });

  it("shows what was selected rather than its container's whole text", () => {
    const summary = summarizeEvent(event("select", { tag: "th", text: "Quantity" }, { text: "Quanti" }));
    expect(summary).toBe("th «Quanti» · selection");
    // A redacted selection falls back to the container.
    expect(summarizeEvent(event("select", { tag: "p", text: "Hello" }, { text: "" }))).toBe("p «Hello» · selection");
  });

  it("keeps the element part short and on one line", () => {
    const text = "Export every order of this quarter to a CSV file\nand email it to accounting";
    const summary = summarizeEvent(event("point", { text }));
    const elementPart = summary.replace(/ · Alt\+click$/, "");
    expect(elementPart).toBe("button «Export every order of this qua…»");
    expect(elementPart).toHaveLength(MAX_ELEMENT_SUMMARY);
    expect(summary).not.toContain("\n");
  });

  it("shows only tag and label for a sensitive element, whatever else the event holds (D8)", () => {
    // describeElement already empties a sensitive element's text; even if something slipped
    // through, the summary must not show it.
    const sensitive = { tag: "input", text: "hunter2", label: "Password", sensitive: true } as const;
    expect(summarizeEvent(event("point", sensitive))).toBe("input «Password» · Alt+click");
    expect(summarizeEvent(event("select", { ...sensitive, tag: "div", label: undefined }, { text: "hunter2" }))).toBe(
      "div · selection",
    );
  });
});
