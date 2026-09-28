// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_DESCRIBE_OPTIONS } from "./options";
import { visibleText } from "./text";

function textFrom(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  return visibleText(root, DEFAULT_DESCRIBE_OPTIONS, 500);
}

describe("visibleText", () => {
  it("separates adjacent inline sibling text", () => {
    expect(textFrom('<a><span>Messages</span><span>3</span></a>')).toBe("Messages 3");
  });

  it("does not add extra spaces when inline siblings already have whitespace", () => {
    expect(textFrom('<a><span>Messages </span><span> 3</span></a>')).toBe("Messages 3");
  });
});
