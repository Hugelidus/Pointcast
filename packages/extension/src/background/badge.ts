import { browser } from "wxt/browser";
import type { RecorderState } from "../recorder-state";
import { readState } from "../state-store";

const GREY = "#5f6368";
const RED = "#d93025";
const AMBER = "#e37400";
const GREEN = "#188038";

const BADGE_BY_STATUS: Record<RecorderState["status"], { text: string; color: string }> = {
  idle: { text: "", color: GREY },
  starting: { text: "…", color: GREY },
  recording: { text: "REC", color: RED },
  // Stop → Markdown takes seconds to minutes: amber says "working on it" even with the popup closed.
  stopping: { text: "…", color: AMBER },
  processing: { text: "…", color: AMBER },
};

export async function showBadge(state: RecorderState): Promise<void> {
  const { text, color } = BADGE_BY_STATUS[state.status];
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeText({ text });
}

/** How long "✓" or "!" stays on the toolbar icon after processing ends. */
export const OUTCOME_BADGE_MS = 5_000;

/**
 * "✓" (green) when the Markdown is ready, "!" (red) when processing failed, then cleared.
 * The timer lives in this service worker instance: if Chrome stops the worker first, the mark
 * simply stays until the next state change redraws the badge, which is harmless.
 */
export async function showOutcomeBadge(ok: boolean): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ color: ok ? GREEN : RED });
  await browser.action.setBadgeText({ text: ok ? "✓" : "!" });
  setTimeout(() => {
    void readState().then((state) => (state.status === "idle" ? showBadge(state) : undefined));
  }, OUTCOME_BADGE_MS);
}
