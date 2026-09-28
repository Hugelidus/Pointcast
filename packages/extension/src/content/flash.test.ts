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

  it("draws a capture as a violet ring inside a white one, never in the error red", () => {
    flashElement(document.getElementById("target") as Element);
    const style = overlays()[0]?.style;
    const outline = style?.getPropertyValue("outline") ?? "";
    expect(outline).toContain("solid");
    expect(outline).toMatch(/#7c3aed|rgb\(124, 58, 237\)/);
    expect(outline).not.toMatch(/#ea4335|rgb\(234, 67, 53\)/);
    expect(style?.getPropertyValue("box-shadow")).toMatch(/#fff|rgb\(255, 255, 255\)/);
  });

  it("does not fade with reduced motion, and still removes the overlay", () => {
    const animate = vi.fn();
    const original = { animate: HTMLElement.prototype.animate, matchMedia: window.matchMedia };
    const prefers = (reduce: boolean) =>
      ((query: string) => ({ matches: reduce && query.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    HTMLElement.prototype.animate = animate;
    window.matchMedia = prefers(true);
    try {
      flashElement(document.getElementById("target") as Element);
      expect(animate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(FLASH_MS);
      expect(overlays()).toHaveLength(0);

      window.matchMedia = prefers(false);
      flashElement(document.getElementById("target") as Element);
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.animate = original.animate;
      window.matchMedia = original.matchMedia;
    }
  });

  it("draws an undone element in grey and dashed, never in the capture style", () => {
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
