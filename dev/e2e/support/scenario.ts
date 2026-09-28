import { expect, type Locator, type Page } from "@playwright/test";
import type { ElementInfo, Gesture } from "../../../packages/core/src/schema";

/** Selector of the REC badge inside the indicator's open shadow root (Playwright pierces it). */
export const INDICATOR = "[data-pointcast-ui] .rec";

/** Typed into the secret fields by the privacy scenario; must never reach the session. */
export const CANARY = "CANARY-7391";

/**
 * What one gesture of the scenario must produce in session.json.
 * `window` is where tStart must fall, in ms from t0: measured around the action on the Node
 * side (same machine clock as the browser's Date.now()), so it proves the event time is the
 * gesture's time and not, say, the time the recorder received it.
 */
export interface ExpectedEvent {
  label: string;
  gesture: Gesture;
  url: string;
  element: Partial<ElementInfo>;
  selectionText?: string;
  window: [number, number];
  /** For gestures timed on a spoken word: when the test meant to perform them (ms from t0). */
  scheduledMs?: number;
}

/** Tolerance added around each measured window: the browser stamps the event a few ms after Node's clock read. */
const WINDOW_SLACK_MS = 30;

/**
 * Drives the app page and writes down, step by step, the event each gesture must produce.
 * Only gestures that pointcast records (click, Alt+click, selection) are expected; typing
 * and navigation by themselves produce nothing.
 */
export class Scenario {
  readonly expected: ExpectedEvent[] = [];

  constructor(
    readonly page: Page,
    readonly t0: number,
  ) {}

  /** Runs `action` and expects one event whose tStart falls inside the time the action took. */
  async gesture(
    expectation: Omit<ExpectedEvent, "window" | "url"> & { url?: string },
    action: () => Promise<void>,
  ): Promise<void> {
    const url = expectation.url ?? this.page.url();
    const before = Date.now() - this.t0;
    await action();
    const after = Date.now() - this.t0;
    this.expected.push({ ...expectation, url, window: [before - WINDOW_SLACK_MS, after + WINDOW_SLACK_MS] });
  }

  /** Waits for a full page load and for pointcast to be capturing in the new document. */
  async waitForPage(path: string): Promise<void> {
    await this.page.waitForURL((u) => u.pathname === path);
    // The indicator and capture are switched on together (content.ts): once the badge is
    // visible, clicks on the new page are recorded.
    await expect(this.page.locator(INDICATOR)).toBeVisible();
  }
}

/** Resolves at `epochMs` (Node timers are ~1 ms precise at this scale). */
export async function sleepUntil(epochMs: number): Promise<void> {
  const wait = epochMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Viewport box of the text inside `locator` (not the element's padding box). */
export async function textBox(locator: Locator): Promise<{ left: number; right: number; midY: number }> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, midY: r.top + r.height / 2 };
  });
}

export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A real mouse drag from `from` to `to`, pressing exactly at `pressAt` (epoch ms) when given.
 * Moving to the start point first keeps the time-critical part down to the press itself.
 */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pressAt?: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  if (pressAt !== undefined) await sleepUntil(pressAt);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

/** Alt+click at a point, pressing at `pressAt` (epoch ms) when given. */
export async function altClickAt(page: Page, at: { x: number; y: number }, pressAt?: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  // Playwright applies held keyboard modifiers to mouse events, so pointer/mouse/click all carry altKey.
  await page.keyboard.down("Alt");
  try {
    if (pressAt !== undefined) await sleepUntil(pressAt);
    await page.mouse.click(at.x, at.y);
  } finally {
    await page.keyboard.up("Alt");
  }
}
