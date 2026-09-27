import { describe, expect, it } from "vitest";
import type { CapturedEvent, SessionFile } from "@pointcast/core";
import { buildInitialPrompt } from "./prompt";

function session(events: Partial<CapturedEvent>[]): SessionFile {
  return {
    schemaVersion: 1,
    id: "s",
    startedAt: "2026-01-01T00:00:00.000Z",
    t0: 0,
    durationMs: 1000,
    audio: { file: "audio.wav", format: "wav", sampleRate: 16000, channels: 1 },
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events: events.map((partial, i) => ({
      id: `e${i + 1}`,
      gesture: "click",
      tStart: 0,
      tEnd: 0,
      url: "http://localhost/",
      element: { tag: "button", text: "", selector: "#x", selectorUnique: true, path: "button", html: "" },
      ...partial,
    })) as CapturedEvent[],
  };
}

describe("buildInitialPrompt", () => {
  it("returns undefined when there are no events", () => {
    expect(buildInitialPrompt(session([]))).toBeUndefined();
  });

  it("returns undefined when every element is blank", () => {
    expect(buildInitialPrompt(session([{}, {}]))).toBeUndefined();
  });

  it("joins unique element texts in first-appearance order", () => {
    const prompt = buildInitialPrompt(
      session([
        { element: { tag: "button", text: "Export", selector: "#a", selectorUnique: true, path: "a", html: "" } },
        { element: { tag: "th", text: "Quantity", selector: "#b", selectorUnique: true, path: "b", html: "" } },
      ]),
    );
    expect(prompt).toBe("Export, Quantity");
  });

  it("deduplicates repeated text and falls back to the label when text is empty", () => {
    const prompt = buildInitialPrompt(
      session([
        { element: { tag: "button", text: "Export", selector: "#a", selectorUnique: true, path: "a", html: "" } },
        { element: { tag: "button", text: "Export", selector: "#a", selectorUnique: true, path: "a", html: "" } },
        {
          element: {
            tag: "button",
            text: "",
            label: "Close dialog",
            selector: "#c",
            selectorUnique: true,
            path: "c",
            html: "",
          },
        },
      ]),
    );
    expect(prompt).toBe("Export, Close dialog");
  });

  it("stops adding terms once the prompt would exceed the character budget", () => {
    const longTerms = Array.from({ length: 50 }, (_, i) => ({
      element: {
        tag: "button",
        text: `A fairly long button label number ${i}`,
        selector: `#b${i}`,
        selectorUnique: true,
        path: `b${i}`,
        html: "",
      },
    }));
    const prompt = buildInitialPrompt(session(longTerms));
    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeLessThanOrEqual(300);
    // Growing the list further would only ever shrink or hold the length steady, never exceed it.
    expect(prompt).toContain("A fairly long button label number 0");
  });
});
