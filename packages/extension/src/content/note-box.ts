import { UI_ATTRIBUTE } from "@pointcast/core";
import { composedParent } from "../lib/dom";

/**
 * Typed mode (D12): the box where the user types what should change about the element they just
 * pointed at, instead of saying it.
 *
 * The gesture reaches the recorder as soon as it happens, exactly as in voice mode (nothing is
 * held back in the page, which may unload); the note follows it. The note is sent on every change
 * (a small message, applied in the order sent), and again when the page is hidden, loses focus or
 * unloads, so a Stop from the popup or the shortcut finds nothing missing.
 *
 * - Enter saves (with an empty box: the gesture is kept without a note); Shift+Enter is a new line.
 * - Esc cancels the gesture: the recorder removes it, as Undo would.
 * - Pointing again saves the open box first (kept without a note when empty): one box at a time.
 *   However the user points: an Alt+click, a drag or a double-click selection.
 * - A press outside the box saves a note, and cancels an empty box, like a dismissed popover. As
 *   that press may be the start of a selection (the previous rule), an empty box is cancelled
 *   only once the press is over and no gesture came of it.
 *
 * Keyboard isolation: while the box has the focus, the app must not react to typing (a "/"
 * shortcut, a Backspace that deletes a row). A listener on window in the capture phase stops every
 * keyboard, input, focus and pointer event bound for the box before any listener of the app on
 * document, <body> or a framework root can see it. Only propagation is stopped, never the default
 * action, so the text still goes into the box. It is added once, when the content script starts,
 * so it also comes before the app's own window listeners added after that; it does nothing while
 * no box is open. Focus traps (modal libraries) must not pull the focus back into the app: the
 * focus moving from the app to the box is hidden from them, and a focus the page moves elsewhere
 * while the box is open (no press happened: that would have closed it) goes back to the box.
 *
 * Privacy: the shadow root is closed, so page scripts can neither read nor rewrite the note, which
 * becomes the user's own instruction to the coding agent, unredacted (D12). What it cannot hide: a
 * page script that listened on window in the capture phase before the content script started
 * sees the key events of the note (PRIVACY.md). On the user's own dev build that is their code.
 *
 * Top layer: the box for an element inside a modal <dialog>, an open popover or the fullscreen
 * element is mounted inside that element (everything outside a modal dialog is inert, so a box
 * there could not be typed into) and shown as a popover itself, so it sits above that element and
 * none of its ancestors clips or moves it.
 */

/** After a press that closed an empty box, how long a gesture may take to follow (a double click). */
export const GESTURE_WAIT_MS = 500;
/** Gap between the element and the box, and between the box and the viewport edges. */
const GAP_PX = 8;
const WIDTH_PX = 300;

/** The same ink, violet and Inter as the pill (indicator.ts), so both read as Pointcast on any app. */
const STYLE = `
  :host { all: initial; }
  .box {
    position: fixed; z-index: 2147483647; box-sizing: border-box;
    display: grid; gap: 6px; padding: 8px;
    border-radius: 10px; background: rgba(18, 15, 45, 0.96); color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    font: 500 13px/1.4 Inter, system-ui, sans-serif;
    animation: appear 120ms ease-out;
  }
  .title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: #c4b5fd; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #a78bfa; }
  textarea {
    box-sizing: border-box; width: 100%; min-height: 56px; max-height: 160px; margin: 0; padding: 6px 8px;
    resize: vertical; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.07); color: #fff; font: inherit; font-weight: 400;
    caret-color: #c4b5fd;
  }
  textarea::placeholder { color: rgba(255, 255, 255, 0.6); }
  textarea:focus { outline: none; }
  textarea:focus-visible, textarea:focus { outline: 2px solid #a78bfa; outline-offset: 1px; border-color: transparent; }
  .hint { font-size: 11px; color: rgba(255, 255, 255, 0.7); }
  kbd { font: 10.5px ui-monospace, Consolas, monospace; padding: 0 3px; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 3px; }
  @keyframes appear { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .box { animation: none; } }
`;

export const NOTE_PLACEHOLDER = "What should change here?";

/** Events bound for the box that must never reach the app (see above). */
const ISOLATED_EVENTS = [
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "textInput",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "paste",
  "copy",
  "cut",
  "focusin",
  "focusout",
  "focus",
  "blur",
  "pointerdown",
  "pointerup",
  "pointercancel",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
] as const;

const FRAME_TAGS = new Set(["iframe", "frame", "object", "embed"]);

export interface NoteBoxDependencies {
  /** The note typed so far for event `id` ("" removes it). Fire and forget. */
  setNote(id: string, note: string): void;
  /** The box was cancelled: remove event `id`. Fire and forget. */
  discard(id: string): void;
}

export interface NoteBox {
  /**
   * Opens the box next to `target` for the gesture the recorder is accepting: `eventId` resolves
   * to its id, or to undefined when it was refused (the recording stopped), which closes the box.
   * An open box is saved first.
   */
  open(eventId: Promise<string | undefined>, target: Element): void;
  /** The recording ended: the box goes, after sending what was typed (a no-op if too late). */
  close(): void;
  /** An Undo removed event `id`: its box goes without a word to the recorder. */
  undone(id: string): void;
  isOpen(): boolean;
  /** The content script is going away: closes the box and removes the window listeners. */
  dispose(): void;
}

/** Open a typed note only after the recorder has accepted the gesture. */
export function openAfterAcceptance(box: Pick<NoteBox, "open">, eventId: Promise<string | undefined>, target: Element): void {
  void eventId.then((id) => {
    if (id !== undefined) box.open(Promise.resolve(id), target);
  });
}

interface OpenBox {
  host: HTMLElement;
  box: HTMLElement;
  textarea: HTMLTextAreaElement;
  target: Element;
  eventId: Promise<string | undefined>;
  /** Known once the recorder answered. */
  id?: string;
  /** What had the focus before the box took it, to give it back on Enter and Esc. */
  previousFocus: Element | null;
  sent: string | undefined;
  cleanup: (() => void)[];
}

/** An empty box closed by a press outside: cancelled unless that press turns out to be a gesture. */
interface PendingCancel {
  eventId: Promise<string | undefined>;
  timer?: ReturnType<typeof setTimeout>;
}

type CloseHow =
  /** Enter, or pointing again: keep the gesture, with the note when there is one. */
  | "save"
  /** Esc: remove the gesture. */
  | "cancel"
  /** A press outside the box: save a note; an empty box is cancelled unless a gesture follows. */
  | "outside"
  /** The recording stopped: send what was typed, which the recorder ignores if it is too late. */
  | "drop"
  /** Undo removed the gesture, or the recorder refused it: nothing more to tell the recorder. */
  | "gone";

export function createNoteBox(doc: Document, deps: NoteBoxDependencies): NoteBox {
  const win = doc.defaultView;
  if (win === null) throw new Error("createNoteBox needs a document attached to a window");
  let current: OpenBox | undefined;
  let pending: PendingCancel | undefined;

  function discard(eventId: Promise<string | undefined>): void {
    void eventId.then((id) => {
      if (id !== undefined) deps.discard(id);
    });
  }

  /** The press that closed an empty box is over and no gesture came of it: cancel that box. */
  function settlePending(): void {
    const cancelled = pending;
    if (!cancelled) return;
    pending = undefined;
    clearTimeout(cancelled.timer);
    discard(cancelled.eventId);
  }

  /** Sends the text now, once the id is known; the recorder applies notes in the order sent. */
  function sync(open: OpenBox): void {
    const text = open.textarea.value;
    if (text === open.sent) return;
    open.sent = text;
    void open.eventId.then((id) => {
      if (id !== undefined) deps.setNote(id, text);
    });
  }

  function close(how: CloseHow, restoreFocus: boolean): void {
    const open = current;
    if (!open) return;
    current = undefined;
    for (const undo of open.cleanup) undo();
    const empty = open.textarea.value.trim() === "";
    if (how === "cancel") {
      discard(open.eventId);
    } else if (how === "outside" && empty) {
      // Decided once the press is over (see the top of this file).
      settlePending();
      pending = { eventId: open.eventId };
    } else if (how !== "gone") {
      sync(open);
    }
    // Before removing the host: removing a focused element leaves the focus nowhere.
    const previous = open.previousFocus;
    if (restoreFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    open.host.remove();
  }

  function place(open: OpenBox): void {
    const viewportWidth = doc.documentElement.clientWidth || win!.innerWidth;
    const viewportHeight = doc.documentElement.clientHeight || win!.innerHeight;
    const width = Math.max(0, Math.min(WIDTH_PX, viewportWidth - 2 * GAP_PX));
    open.box.style.width = `${width}px`;
    const rect = open.target.getBoundingClientRect();
    const height = open.box.offsetHeight;
    const below = rect.bottom + GAP_PX;
    const above = rect.top - GAP_PX - height;
    // Below the element when it fits, else above it, else as close as the viewport allows.
    let top = below + height <= viewportHeight - GAP_PX ? below : above >= GAP_PX ? above : viewportHeight - GAP_PX - height;
    top = Math.max(GAP_PX, top);
    const left = Math.min(Math.max(GAP_PX, rect.left), Math.max(GAP_PX, viewportWidth - GAP_PX - width));
    open.box.style.top = `${Math.round(top)}px`;
    open.box.style.left = `${Math.round(left)}px`;
  }

  /**
   * The element in the top layer that `target` is in: a modal dialog (everything outside it is
   * inert), an open popover or the fullscreen element. Null for the rest of the page.
   */
  function topLayerContainer(target: Element): Element | null {
    for (let el: Element | null = target; el !== null; el = composedParent(el)) {
      if (el === doc.fullscreenElement || matches(el, ":modal") || matches(el, ":popover-open")) return el;
    }
    return null;
  }

  function mount(target: Element, eventId: Promise<string | undefined>): OpenBox {
    const host = doc.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "note");
    // Closed: page scripts must not read or rewrite the note (see the top of this file).
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    const box = doc.createElement("div");
    box.className = "box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Pointcast note");
    const title = doc.createElement("div");
    title.className = "title";
    const dot = doc.createElement("span");
    dot.className = "dot";
    title.append(dot, "Pointcast note");
    const textarea = doc.createElement("textarea");
    textarea.rows = 3;
    textarea.placeholder = NOTE_PLACEHOLDER;
    textarea.setAttribute("aria-label", NOTE_PLACEHOLDER);
    textarea.setAttribute("aria-describedby", "hint");
    textarea.spellcheck = true;
    const hint = doc.createElement("div");
    hint.className = "hint";
    hint.id = "hint";
    const key = (text: string) => {
      const kbd = doc.createElement("kbd");
      kbd.textContent = text;
      return kbd;
    };
    hint.append(key("Enter"), " save · ", key("Shift+Enter"), " new line · ", key("Esc"), " cancel");
    box.append(title, textarea, hint);
    root.append(style, box);
    const previousFocus = doc.activeElement;
    const container = topLayerContainer(target);
    // documentElement rather than body: SPA frameworks sometimes replace <body> wholesale.
    (container ?? doc.documentElement).append(host);
    if (container !== null && typeof host.showPopover === "function") {
      // Above the dialog or popover it is in, and out of reach of its transform and overflow: the
      // top layer is laid out against the viewport. Manual: no light dismiss, no Esc of its own.
      host.popover = "manual";
      try {
        host.showPopover();
      } catch {
        // Still inside the container, so still usable, only not above it.
      }
    }
    return { host, box, textarea, target, eventId, previousFocus, sent: "", cleanup: [] };
  }

  /** Whether the focus event comes from, or goes to, the box. */
  function focusRelatesToBox(open: OpenBox, event: Event): boolean {
    const related = (event as FocusEvent).relatedTarget;
    return related instanceof Node && open.host.contains(related);
  }

  /** On window in the capture phase for the life of the content script (see the top of this file). */
  function guard(event: Event): void {
    const open = current;
    if (open && event.composedPath().includes(open.host)) {
      event.stopImmediatePropagation();
      if (event.type === "input") sync(open);
      if (event.type === "keydown") onKey(event as KeyboardEvent);
      return;
    }
    if (open) {
      // Only the press starts "outside": the click that ends a selection gesture must not
      // close the box that gesture just opened.
      if (event.type === "pointerdown") close("outside", false);
      // The app's element losing the focus to the box: the app would see its focus leave for
      // somewhere it does not know, and a focus trap would pull it back, so the typing would land
      // in the app. Hidden from it, as everything else about the box.
      else if ((event.type === "focusout" || event.type === "blur") && focusRelatesToBox(open, event)) {
        event.stopImmediatePropagation();
      } else if ((event.type === "focusin" || event.type === "focus") && event.target instanceof Element) {
        if (FRAME_TAGS.has(event.target.localName)) {
          // A press inside a frame reaches this document only as the frame taking the focus.
          if (event.type === "focusin") close("outside", false);
        } else {
          // No press happened (it would have closed the box), and Tab stays in the box: the page
          // moved the focus itself, e.g. a focus trap. The box keeps it while it is open.
          if (focusRelatesToBox(open, event)) event.stopImmediatePropagation();
          if (event.type === "focusin") open.textarea.focus({ preventScroll: true });
        }
      }
    }
    if (pending) {
      // The second press of a double click is still the same try at a gesture; each release
      // starts the wait again.
      if (event.type === "pointerdown") clearTimeout(pending.timer);
      if (event.type === "pointerup" || event.type === "pointercancel") {
        clearTimeout(pending.timer);
        pending.timer = setTimeout(settlePending, GESTURE_WAIT_MS);
      }
    }
  }

  /** The popup opening (to press Stop) blurs or hides the page: send what was typed right away. */
  function flush(): void {
    if (current) sync(current);
  }
  function onVisibilityChange(): void {
    if (doc.visibilityState === "hidden") flush();
  }
  function onPageHide(): void {
    flush();
    // No time left for the press to become a gesture.
    settlePending();
  }

  const globalListeners: [EventTarget, string, EventListener, boolean][] = [
    ...ISOLATED_EVENTS.map((type): [EventTarget, string, EventListener, boolean] => [win, type, guard, true]),
    [win, "blur", flush, false],
    [win, "pagehide", onPageHide, false],
    [doc, "visibilitychange", onVisibilityChange, false],
  ];
  for (const [target, type, listener, capture] of globalListeners) target.addEventListener(type, listener, capture);

  function listen(open: OpenBox): void {
    const reposition = () => place(open);
    win!.addEventListener("scroll", reposition, { capture: true, passive: true });
    win!.addEventListener("resize", reposition, { passive: true });
    open.cleanup.push(() => {
      win!.removeEventListener("scroll", reposition, { capture: true });
      win!.removeEventListener("resize", reposition);
    });
  }

  function onKey(event: KeyboardEvent): void {
    // An IME composing a word uses Enter to pick it: that Enter is not a save.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      close("save", true);
      swallowKeyUp(event.key);
    } else if (event.key === "Escape") {
      // preventDefault also keeps a modal <dialog> the box is in from closing on this Esc.
      event.preventDefault();
      close("cancel", true);
      swallowKeyUp(event.key);
    } else if (event.key === "Tab") {
      // The box is the one thing to do; Enter and Esc leave it. Tab would move the focus into the
      // app with the box still open.
      event.preventDefault();
    }
  }

  /**
   * The Enter or Esc that closed the box is released after the box is gone, on whatever has the
   * focus then: the app would see a keyup it never saw pressed. That one keyup is kept away too.
   */
  function swallowKeyUp(key: string): void {
    const swallow = (event: KeyboardEvent) => {
      if (event.key !== key) return;
      event.stopImmediatePropagation();
      done();
    };
    const done = () => {
      clearTimeout(timer);
      win!.removeEventListener("keyup", swallow, true);
    };
    // A key held for longer than this is not the one that closed the box any more.
    const timer = setTimeout(done, 2_000);
    win!.addEventListener("keyup", swallow, true);
  }

  return {
    open(eventId, target) {
      close("save", false);
      // A gesture came of the press that closed an empty box: that box's gesture is kept.
      clearTimeout(pending?.timer);
      pending = undefined;
      const open = mount(target, eventId);
      current = open;
      listen(open);
      place(open);
      open.textarea.focus({ preventScroll: true });
      void eventId.then((id) => {
        open.id = id;
        if (id === undefined && current === open) close("gone", true);
      });
    },
    close() {
      close("drop", false);
      settlePending();
    },
    undone(id) {
      if (current?.id === id) close("gone", true);
    },
    isOpen() {
      return current !== undefined;
    },
    dispose() {
      close("drop", false);
      settlePending();
      for (const [target, type, listener, capture] of globalListeners) target.removeEventListener(type, listener, capture);
    },
  };
}

/** A selector the engine may not know (jsdom and `:popover-open`, say): unknown means no match. */
function matches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}
