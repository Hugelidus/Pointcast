import { UI_ATTRIBUTE } from "@pointcast/core";
import { pillView, type PillView } from "../processing/progress";
import type { RecorderState } from "../recorder-state";

export interface Indicator {
  /** Shows `view`, or removes the pill for null. */
  render(view: PillView | null): void;
}

/**
 * The pill must read on any app, light or dark: brand ink background, a 1 px light border and a
 * shadow so it never melts into a dark page, and one colored glyph that carries the outcome.
 * Red stays reserved for recording (the dot) and errors; processing is the brand violet, so amber
 * only ever means "warning". Rounded rectangle for multi-line content, stadium for the one-word
 * REC and short notices.
 */
const STYLE = `
  :host { all: initial; }
  .pill {
    position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
    pointer-events: none;
    display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 6px; row-gap: 4px;
    max-width: 320px; padding: 6px 10px; border-radius: 10px;
    background: rgba(18, 15, 45, 0.92); color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    font: 600 12px/1.4 Inter, system-ui, sans-serif;
  }
  .pill.rec, .pill.notice { border-radius: 999px; padding: 4px 10px; }
  .pill.rec { letter-spacing: 0.06em; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #ea4335; }
  .processing .dot { background: #a78bfa; animation: pulse 1s ease-in-out infinite alternate; }
  .notice .dot { background: #9aa0a6; }
  .glyph { font-size: 13px; line-height: 1; }
  .done .glyph { color: #34a853; }
  .warning .glyph { color: #fbbc04; }
  .error .glyph { color: #f28b82; }
  .bar { grid-column: 1 / -1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
  .fill { height: 100%; background: #a78bfa; }
  /* By scale, not opacity: a faded dot turns muddy on the dark background. */
  @keyframes pulse { from { transform: scale(0.6); } to { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) {
    .processing .dot { animation: none; }
  }
  /* Read by screen readers, never seen: the live region announces stage changes only. */
  .live {
    position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
`;

const CLASS_BY_KIND: Record<PillView["kind"], string> = {
  recording: "rec",
  processing: "processing",
  done: "done",
  warning: "warning",
  error: "error",
  notice: "notice",
};

/**
 * The outcome's glyph when pillView's text does not start with one. The recording was saved in
 * both done and warning: the color and the words tell a warning apart.
 */
const GLYPH_BY_KIND: Partial<Record<PillView["kind"], string>> = {
  done: "✓",
  warning: "✓",
  error: "✗",
};

/** pillView writes the glyph at the start of the text ("✓ Copied"); the pill draws it apart, in color. */
const LEADING_GLYPH = new RegExp("^([\\u2713\\u2717\\u26A0])\\uFE0F?\\s*", "u");

/** The glyph drawn in color (undefined: a dot) and the words, for an outcome's text. */
export function splitGlyph(view: PillView): { glyph?: string; text: string } {
  if (view.kind === "recording") return { text: "REC" };
  const match = LEADING_GLYPH.exec(view.text);
  const text = match ? view.text.slice(match[0].length) : view.text;
  const glyph = GLYPH_BY_KIND[view.kind];
  return glyph ? { glyph: match?.[1] ?? glyph, text } : { text };
}

/**
 * What a screen reader hears. The live region only speaks when this changes, so each stage is
 * announced once and the countdown ("~0:25", "~0:24"…) or the MB counter never are (UX item 13):
 * a processing text is cut after its ellipsis ("Processing…", "Downloading the speech model…").
 */
export function announcement(view: PillView | null): string {
  if (!view) return "";
  if (view.kind === "recording") return "Pointcast is recording";
  const { text } = splitGlyph(view);
  if (view.kind !== "processing") return `Pointcast: ${text}`;
  const stage = text.replace(/\s*\(first time only\)/, "");
  const cut = stage.indexOf("…");
  return `Pointcast: ${cut >= 0 ? stage.slice(0, cut + 1) : stage}`;
}

/**
 * A live region inserted together with its text is often not announced: screen readers only
 * watch regions that already exist. The first announcement after mounting waits this long.
 */
export const FIRST_ANNOUNCEMENT_DELAY_MS = 100;

/**
 * The pill in the page corner: "● REC" while recording, then "Processing… ~0:25" with an
 * estimated progress bar, then "✓ Copied · saved to Downloads" (or the warning, or the error)
 * for a few seconds, so the user always sees what happens after Stop without opening the popup.
 * - pointer-events: none, so it never blocks or receives a click meant for the app.
 * - The host carries UI_ATTRIBUTE, so capture code ignores it (Pointcast never records itself).
 * - Content lives in a shadow root so the app's CSS (e.g. `div { display: none }`) cannot
 *   restyle it, and its CSS cannot leak into the app.
 * - The visible pill is hidden from screen readers, which would otherwise hear the countdown
 *   every second; a separate live region says each stage once (announcement()).
 */
export function createIndicator(doc: Document): Indicator {
  let host: HTMLElement | null = null;
  let pill: HTMLElement | null = null;
  let live: HTMLElement | null = null;
  let spoken = "";
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  function mount(): { pill: HTMLElement; live: HTMLElement; fresh: boolean } {
    if (host?.isConnected && pill && live) return { pill, live, fresh: false };
    host = doc.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "indicator");
    const root = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    pill = doc.createElement("div");
    pill.setAttribute("aria-hidden", "true");
    live = doc.createElement("div");
    live.className = "live";
    live.setAttribute("role", "status");
    spoken = "";
    root.append(style, pill, live);
    // documentElement rather than body: SPA frameworks sometimes replace <body> wholesale.
    doc.documentElement.append(host);
    return { pill, live, fresh: true };
  }

  function announce(region: HTMLElement, text: string, fresh: boolean): void {
    if (text === spoken) return;
    spoken = text;
    clearTimeout(announceTimer);
    announceTimer = undefined;
    if (!fresh) {
      region.textContent = text;
      return;
    }
    announceTimer = setTimeout(() => {
      announceTimer = undefined;
      region.textContent = text;
    }, FIRST_ANNOUNCEMENT_DELAY_MS);
  }

  return {
    render(view) {
      if (!view) {
        clearTimeout(announceTimer);
        announceTimer = undefined;
        host?.remove();
        host = null;
        pill = null;
        live = null;
        return;
      }
      const mounted = mount();
      const element = mounted.pill;
      element.className = `pill ${CLASS_BY_KIND[view.kind]}`;
      const { glyph, text } = splitGlyph(view);
      const mark = doc.createElement("span");
      if (glyph) {
        mark.className = "glyph";
        mark.textContent = glyph;
      } else {
        mark.className = "dot";
      }
      element.replaceChildren(mark, text);
      if (view.kind === "processing") {
        const bar = doc.createElement("div");
        bar.className = "bar";
        const fill = doc.createElement("div");
        fill.className = "fill";
        fill.style.width = `${Math.round(view.fraction * 100)}%`;
        bar.append(fill);
        element.append(bar);
      }
      announce(mounted.live, announcement(view), mounted.fresh);
    },
  };
}

/** Long enough to read "Undone: button “Export”" while talking. */
export const NOTICE_MS = 2500;

/**
 * Keeps the pill in step with the recorder state. While a view depends on the clock (the time
 * left, or how long "✓ Copied" stays), it redraws every second; otherwise no timer runs.
 * `notice` shows a short message instead of REC for NOTICE_MS, only while recording.
 * A Record that failed to start (e.g. the microphone was denied) is an ordinary timed view of
 * pillView, so it follows the same one-second redraw until it expires.
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
