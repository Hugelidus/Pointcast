import { describe, expect, it } from "vitest";
import { readableSummary } from "./content/undo-feedback";
import { readableEvent } from "./event-words";
import { friendlyEvent } from "./popup/view";

describe("readableEvent", () => {
  it("names the element with a word and quotes its name", () => {
    expect(readableEvent("a «View report» · Alt+click")).toBe("link “View report”");
    expect(readableEvent("select «Country» · click")).toBe("dropdown “Country” · click");
    expect(readableEvent("pre · selection")).toBe("code · selection");
  });

  it("never reads a tag as an Object.prototype property", () => {
    expect(readableEvent("constructor «x» · Alt+click")).toBe("“x”");
    expect(readableEvent("constructor · click")).toBe("element · click");
  });

  it("is what both the popup and the pill show, so an Undo reads the same in both", () => {
    for (const summary of ["select «Country» · click", "span «3» · Alt+click", "my-widget · selection", "link · click"]) {
      expect(friendlyEvent(summary)).toBe(readableSummary(summary));
    }
  });
});
