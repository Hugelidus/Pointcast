// @vitest-environment jsdom
import { UI_ATTRIBUTE } from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLASH_MS, flashElement } from "./flash";

const overlays = () => document.querySelectorAll<HTMLElement>(`[${UI_ATTRIBUTE}="flash"]`);

describe("flashElement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="target">Export</button>';
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const overlay of overlays()) overlay.remove();
  });

  it("draws an overlay marked as pointcast UI over the element's box", () => {
    const target = document.getElementById("target") as HTMLElement;
    target.getBoundingClientRect = () => ({ top: 10, left: 20, width: 80, height: 30 }) as DOMRect;
    flashElement(target);

    const [overlay] = overlays();
    expect(overlay).toBeDefined();
    expect(overlay?.parentElement).toBe(document.documentElement);
    expect(overlay?.textContent).toBe("");
    const style = overlay?.style;
    expect([style?.top, style?.left, style?.width, style?.height]).toEqual(["10px", "20px", "80px", "30px"]);
    // Never a click or selection target, and page CSS cannot override it.
    expect(style?.getPropertyValue("pointer-events")).toBe("none");
    expect(style?.getPropertyPriority("pointer-events")).toBe("important");
    // The app's element itself is left untouched.
    expect(target.getAttribute("style")).toBeNull();
    expect(target.hasAttribute(UI_ATTRIBUTE)).toBe(false);
  });

  it(`removes the overlay after ${FLASH_MS} ms`, () => {
    flashElement(document.getElementById("target") as Element);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(overlays()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(overlays()).toHaveLength(0);
  });

  it("draws an undone element in grey and dashed, never in the capture red", () => {
    flashElement(document.getElementById("target") as Element, FLASH_MS, true);
    const outline = overlays()[0]?.style.getPropertyValue("outline") ?? "";
    expect(outline).toContain("dashed");
    expect(outline).not.toContain("solid");
  });

  it("gives each captured element its own overlay", () => {
    const target = document.getElementById("target") as Element;
    flashElement(target);
    vi.advanceTimersByTime(200);
    flashElement(target);
    expect(overlays()).toHaveLength(2);
    vi.advanceTimersByTime(200);
    expect(overlays()).toHaveLength(1);
  });
});
