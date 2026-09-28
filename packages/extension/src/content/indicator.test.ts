// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_ATTRIBUTE } from "@pointcast/core";
import type { RecorderState } from "../recorder-state";
import { announcement, createIndicator, FIRST_ANNOUNCEMENT_DELAY_MS, followWithPill, NOTICE_MS, splitGlyph } from "./indicator";

const selector = `[${UI_ATTRIBUTE}]`;
const pill = () => document.querySelector(selector)?.shadowRoot?.querySelector(".pill");
const live = () => document.querySelector(selector)?.shadowRoot?.querySelector('[role="status"]');

describe("createIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const element of document.querySelectorAll(selector)) element.remove();
  });

  it("shows a single REC pill marked as pointcast UI", () => {
    const indicator = createIndicator(document);
    indicator.render({ kind: "recording" });
    indicator.render({ kind: "recording" });

    const hosts = document.querySelectorAll(selector);
    expect(hosts).toHaveLength(1);
    expect(pill()?.classList.contains("rec")).toBe(true);
    expect(pill()?.textContent).toBe("REC");
    expect(hosts[0]?.shadowRoot?.querySelector("style")?.textContent).toContain("pointer-events: none");
  });

  it("turns into the processing estimate with a bar, then the outcome", () => {
    const indicator = createIndicator(document);
    indicator.render({ kind: "recording" });
    indicator.render({ kind: "processing", text: "Processing… ~0:25", fraction: 0.4 });
    expect(pill()?.classList.contains("rec")).toBe(false);
    expect(pill()?.textContent).toBe("Processing… ~0:25");
    expect((pill()?.querySelector(".fill") as HTMLElement | null)?.style.width).toBe("40%");

    indicator.render({ kind: "done", text: "✓ Copied · saved to Downloads" });
    expect(pill()?.className).toBe("pill done");
    // One glyph, drawn apart in its own color; the words follow it.
    expect(pill()?.querySelector(".glyph")?.textContent).toBe("✓");
    expect(pill()?.querySelector(".dot")).toBeNull();
    expect(pill()?.textContent).toBe("✓Copied · saved to Downloads");
    expect(pill()?.querySelector(".bar")).toBeNull();
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("marks a saved session with a warning apart from a clean success, and an error with ✗", () => {
    const indicator = createIndicator(document);
    indicator.render({ kind: "processing", text: "Saving…", fraction: 0.95 });
    expect(pill()?.querySelectorAll(".dot, .glyph")).toHaveLength(1);
    expect(pill()?.querySelector(".dot")).not.toBeNull();

    indicator.render({ kind: "warning", text: "✓ Copied, with a warning. See the Pointcast popup." });
    expect(pill()?.className).toBe("pill warning");
    expect(pill()?.querySelectorAll(".dot, .glyph")).toHaveLength(1);
    expect(pill()?.textContent).toBe("✓Copied, with a warning. See the Pointcast popup.");

    indicator.render({ kind: "error", text: "Could not transcribe. See the Pointcast popup." });
    expect(pill()?.className).toBe("pill error");
    expect(pill()?.querySelector(".glyph")?.textContent).toBe("✗");
  });

  it("styles the pill to be seen on any page, and to hold still with reduced motion", () => {
    createIndicator(document).render({ kind: "recording" });
    const css = document.querySelector(selector)?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(css).toContain("border: 1px solid");
    expect(css).toContain("box-shadow");
    expect(css).toMatch(/\.warning \.glyph \{ color: #fbbc04/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.processing \.dot \{ animation: none/);
    // Processing pulses in violet, by scale; amber is left for warnings.
    expect(css).toMatch(/@keyframes pulse \{[^}]*scale/);
    expect(css).toMatch(/\.processing \.dot \{ background: #a78bfa/);
  });

  it("hides the visible pill from screen readers and announces each stage once in a live region", async () => {
    vi.useFakeTimers();
    const indicator = createIndicator(document);
    indicator.render({ kind: "recording" });
    expect(pill()?.getAttribute("aria-hidden")).toBe("true");
    // A region inserted with its text may go unheard: the first text comes a moment later.
    expect(live()?.textContent).toBe("");
    vi.advanceTimersByTime(FIRST_ANNOUNCEMENT_DELAY_MS);
    expect(live()?.textContent).toBe("Pointcast is recording");

    const region = live();
    const heard: string[] = [];
    new MutationObserver(() => heard.push(region?.textContent ?? "")).observe(region as Node, { childList: true, subtree: true, characterData: true });
    indicator.render({ kind: "processing", text: "Processing… ~0:25", fraction: 0.4 });
    await Promise.resolve();
    indicator.render({ kind: "processing", text: "Processing… ~0:24", fraction: 0.42 });
    await Promise.resolve();
    indicator.render({ kind: "processing", text: "Saving…", fraction: 0.95 });
    await Promise.resolve();
    expect(live()).toBe(region);
    expect(heard).toEqual(["Pointcast: Processing…", "Pointcast: Saving…"]);
  });

  it("removes the pill for null and can show it again", () => {
    const indicator = createIndicator(document);
    indicator.render({ kind: "recording" });
    indicator.render(null);
    expect(document.querySelector(selector)).toBeNull();
    indicator.render({ kind: "recording" });
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("recreates the pill if the page removed it", () => {
    const indicator = createIndicator(document);
    indicator.render({ kind: "recording" });
    document.querySelector(selector)?.remove();
    indicator.render({ kind: "recording" });
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });
});

describe("followWithPill", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a notice instead of REC for a moment while recording, then REC again", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const render = vi.fn();
    const follower = followWithPill({ render }, () => now);
    follower.update({ status: "recording", t0: now });
    follower.notice("Undone: button “Export”");
    expect(render).toHaveBeenLastCalledWith({ kind: "notice", text: "Undone: button “Export”" });

    now += NOTICE_MS;
    vi.advanceTimersByTime(NOTICE_MS);
    expect(render).toHaveBeenLastCalledWith({ kind: "recording" });
  });

  it("never lets a notice hide the processing estimate", () => {
    const render = vi.fn();
    const follower = followWithPill({ render }, () => 1_000_000);
    follower.update({ status: "idle" });
    follower.notice("Undone: th · selection");
    expect(render).toHaveBeenLastCalledWith(null);
    follower.stop();
  });

  it("redraws every second while the view follows the clock, and stops when it is over", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const render = vi.fn();
    const follower = followWithPill({ render }, () => now);
    const done: RecorderState = {
      status: "idle",
      lastSessionId: "s",
      lastResult: { sessionId: "s", finishedAt: now, copied: true, audioMs: 12_000, processingMs: 5_000 },
    };
    follower.update(done);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "done" }));

    now += 6_000;
    vi.advanceTimersByTime(6_000);
    expect(render).toHaveBeenLastCalledWith(null);
    const calls = render.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(render.mock.calls.length).toBe(calls);
  });

  it("draws REC once, with no timer", () => {
    vi.useFakeTimers();
    const render = vi.fn();
    followWithPill({ render }).update({ status: "recording", t0: 1 });
    vi.advanceTimersByTime(5_000);
    expect(render.mock.calls).toEqual([[{ kind: "recording" }]]);
  });
});

describe("splitGlyph", () => {
  it("takes the glyph off the text, or gives an outcome its default one", () => {
    expect(splitGlyph({ kind: "done", text: "✓ Copied · sent to your agent" })).toEqual({ glyph: "✓", text: "Copied · sent to your agent" });
    expect(splitGlyph({ kind: "error", text: "✗ Recording did not start." })).toEqual({ glyph: "✗", text: "Recording did not start." });
    expect(splitGlyph({ kind: "warning", text: "Saved, with a warning." })).toEqual({ glyph: "✓", text: "Saved, with a warning." });
    expect(splitGlyph({ kind: "notice", text: "Undone: “3”" })).toEqual({ text: "Undone: “3”" });
    expect(splitGlyph({ kind: "recording" })).toEqual({ text: "REC" });
  });
});

describe("announcement", () => {
  it("names the stage, never the countdown or the download counter", () => {
    expect(announcement({ kind: "processing", text: "Processing… ~0:25", fraction: 0.4 })).toBe("Pointcast: Processing…");
    expect(announcement({ kind: "processing", text: "Processing… almost done", fraction: 0.95 })).toBe("Pointcast: Processing…");
    expect(announcement({ kind: "processing", text: "Downloading the speech model (first time only)… 12 / 294 MB", fraction: 0.04 })).toBe(
      "Pointcast: Downloading the speech model…",
    );
    expect(announcement({ kind: "done", text: "✓ Copied · saved to Downloads" })).toBe("Pointcast: Copied · saved to Downloads");
    expect(announcement({ kind: "recording" })).toBe("Pointcast is recording");
    expect(announcement(null)).toBe("");
  });
});

describe("the pill in typed mode (D12)", () => {
  it("says Notes rather than REC, since no microphone is on", () => {
    expect(splitGlyph({ kind: "recording", typed: true })).toEqual({ text: "Notes" });
    expect(splitGlyph({ kind: "recording" })).toEqual({ text: "REC" });
    expect(announcement({ kind: "recording", typed: true })).toBe("Pointcast is recording notes");
  });
});
