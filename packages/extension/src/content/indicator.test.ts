// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_ATTRIBUTE } from "@pointcast/core";
import type { RecorderState } from "../recorder-state";
import { createIndicator, followWithPill, NOTICE_MS } from "./indicator";

const selector = `[${UI_ATTRIBUTE}]`;
const pill = () => document.querySelector(selector)?.shadowRoot?.querySelector(".pill");

describe("createIndicator", () => {
  afterEach(() => {
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

    indicator.render({ kind: "done", text: "✓ Copied — paste it into your agent" });
    expect(pill()?.className).toBe("pill done");
    expect(pill()?.querySelector(".bar")).toBeNull();
    expect(document.querySelectorAll(selector)).toHaveLength(1);
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
    follower.notice("Undone: button «Export» · Alt+click");
    expect(render).toHaveBeenLastCalledWith({ kind: "notice", text: "Undone: button «Export» · Alt+click" });

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
    expect(render).toHaveBeenLastCalledWith({ kind: "done", text: "✓ Copied — paste it into your agent" });

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
