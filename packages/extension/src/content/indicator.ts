import { UI_ATTRIBUTE } from "@pointcast/core";
import { pillView, type PillView } from "../processing/progress";
import type { RecorderState } from "../recorder-state";

export interface Indicator {
  /** Shows `view`, or removes the pill for null. */
  render(view: PillView | null): void;
}

const STYLE = `
  :host { all: initial; }
  .pill {
    position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
    pointer-events: none;
    display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 6px; row-gap: 4px;
    max-width: 320px; padding: 4px 10px; border-radius: 999px;
    background: rgba(32, 33, 36, 0.88); color: #fff;
    font: 600 12px/1.4 system-ui, sans-serif;
  }
  .pill.rec { letter-spacing: 0.06em; }
  .pill.processing { border-radius: 10px; padding: 6px 10px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #ea4335; }
  .processing .dot { background: #fbbc04; animation: pulse 1s ease-in-out infinite alternate; }
  .done .dot { background: #34a853; }
  .error .dot { background: #ea4335; }
  .notice .dot { background: #9aa0a6; }
  .bar { grid-column: 1 / -1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
  .fill { height: 100%; background: #fbbc04; }
  @keyframes pulse { from { opacity: 0.4; } to { opacity: 1; } }
`;

const CLASS_BY_KIND: Record<PillView["kind"], string> = {
  recording: "rec",
  processing: "processing",
  done: "done",
  error: "error",
  notice: "notice",
};

/**
 * The pill in the page corner: "● REC" while recording, then "Processing… ~0:25" with an
 * estimated progress bar, then "✓ Copied — paste it into your agent" (or the error) for a few
 * seconds, so the user always sees what happens after Stop without opening the popup.
 * - pointer-events: none, so it never blocks or receives a click meant for the app.
 * - The host carries UI_ATTRIBUTE, so capture code ignores it (pointcast never records itself).
 * - Content lives in a shadow root so the app's CSS (e.g. `div { display: none }`) cannot
 *   restyle it, and its CSS cannot leak into the app.
 */
export function createIndicator(doc: Document): Indicator {
  let host: HTMLElement | null = null;
  let pill: HTMLElement | null = null;

  function mount(): HTMLElement {
    if (host?.isConnected && pill) return pill;
    host = doc.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "indicator");
    const root = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    pill = doc.createElement("div");
    pill.setAttribute("role", "status");
    root.append(style, pill);
    // documentElement rather than body: SPA frameworks sometimes replace <body> wholesale.
    doc.documentElement.append(host);
    return pill;
  }

  return {
    render(view) {
      if (!view) {
        host?.remove();
        host = null;
        pill = null;
        return;
      }
      const element = mount();
      element.className = `pill ${CLASS_BY_KIND[view.kind]}`;
      const dot = doc.createElement("span");
      dot.className = "dot";
      const text = view.kind === "recording" ? "REC" : view.text;
      element.setAttribute("aria-label", view.kind === "recording" ? "pointcast is recording" : `pointcast: ${text}`);
      element.replaceChildren(dot, text);
      if (view.kind === "processing") {
        const bar = doc.createElement("div");
        bar.className = "bar";
        const fill = doc.createElement("div");
        fill.className = "fill";
        fill.style.width = `${Math.round(view.fraction * 100)}%`;
        bar.append(fill);
        element.append(bar);
      }
    },
  };
}

/** Long enough to read "Undone: button «Export» · Alt+click" while talking. */
export const NOTICE_MS = 2500;

/**
 * Keeps the pill in step with the recorder state. While a view depends on the clock (the time
 * left, or how long "✓ Copied" stays), it redraws every second; otherwise no timer runs.
 * `notice` shows a short message instead of REC for NOTICE_MS, only while recording.
 */
export function followWithPill(indicator: Indicator, now: () => number = Date.now): {
  update(state: RecorderState): void;
  notice(text: string): void;
  stop(): void;
} {
  let state: RecorderState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notice: { text: string; until: number } | undefined;

  function draw(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!state) return;
    let view = pillView(state, now());
    if (notice && now() >= notice.until) notice = undefined;
    if (notice && view?.kind === "recording") {
      view = { kind: "notice", text: notice.text };
      timer = setTimeout(draw, Math.max(0, notice.until - now()));
    } else if (view && view.kind !== "recording") {
      timer = setTimeout(draw, 1000);
    }
    indicator.render(view);
  }

  return {
    update(next) {
      state = next;
      draw();
    },
    notice(text) {
      notice = { text, until: now() + NOTICE_MS };
      draw();
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
      state = undefined;
      indicator.render(null);
    },
  };
}
