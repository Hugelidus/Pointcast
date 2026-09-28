// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_ATTRIBUTE } from "@pointcast/core";
import { createNoteBox, GESTURE_WAIT_MS, NOTE_PLACEHOLDER, type NoteBox } from "./note-box";

// The box's shadow root is closed, so page scripts cannot reach it; the tests keep the roots the
// box creates, as the content script itself does.
const roots = new WeakMap<Element, ShadowRoot>();
const realAttachShadow = Element.prototype.attachShadow;
beforeAll(() => {
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = realAttachShadow.call(this, init);
    roots.set(this, root);
    return root;
  };
});
afterAll(() => {
  Element.prototype.attachShadow = realAttachShadow;
});

const hosts = () => document.querySelectorAll(`[${UI_ATTRIBUTE}="note"]`);
const rootOf = (host: Element): ShadowRoot => {
  const root = roots.get(host);
  if (!root) throw new Error("no shadow root");
  return root;
};
const textarea = () => {
  const host = hosts()[0];
  return host ? rootOf(host).querySelector("textarea") : null;
};

/** Real keystrokes are trusted and composed; these cross the shadow boundary the same way. */
function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, composed: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** What typing does: the value changes, then an input event. */
function type(text: string): void {
  const area = textarea();
  if (!area) throw new Error("no note box");
  area.value += text;
  area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text }));
}

function pointer(type: "pointerdown" | "pointerup", target: EventTarget): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, button: 0 }));
}
const pointerdown = (target: EventTarget) => pointer("pointerdown", target);

/** Lets the promises of the accepted ids settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("createNoteBox (typed mode, D12)", () => {
  let box: NoteBox;
  let calls: string[];
  let button: HTMLButtonElement;
  let other: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    document.body.innerHTML = '<button id="export">Export</button><button id="other">Other</button>';
    button = document.querySelector("#export")!;
    other = document.querySelector("#other")!;
    box = createNoteBox(document, {
      setNote: (id, note) => calls.push(`note ${id} ${JSON.stringify(note)}`),
      discard: (id) => calls.push(`discard ${id}`),
    });
  });

  afterEach(() => {
    box.dispose();
    // Ends the wait for the release of a closing Enter or Esc (swallowKeyUp).
    vi.advanceTimersByTime(2_000);
    vi.useRealTimers();
    document.body.innerHTML = "";
    for (const host of hosts()) host.remove();
  });

  it("opens next to the element with the focus in a labelled box marked as Pointcast UI", async () => {
    box.open(Promise.resolve("e1"), button);
    expect(hosts()).toHaveLength(1);
    const area = textarea()!;
    expect(area.placeholder).toBe(NOTE_PLACEHOLDER);
    expect(area.getAttribute("aria-label")).toBe(NOTE_PLACEHOLDER);
    expect(area.getRootNode()).toBeInstanceOf(ShadowRoot);
    expect(rootOf(hosts()[0]!).activeElement).toBe(area);
    const style = rootOf(hosts()[0]!).querySelector("style")!.textContent ?? "";
    expect(style).toContain("prefers-reduced-motion");
    expect(style).toContain("Inter");
  });

  it("keeps the note out of page scripts' reach: the shadow root is closed", () => {
    box.open(Promise.resolve("e1"), button);
    const host = hosts()[0] as HTMLElement;
    expect(host.shadowRoot).toBeNull();
    // What a page sees of the focus: the host, never the textarea.
    expect(document.activeElement).toBe(host);
  });

  it("Enter saves the note and gives the focus back; Shift+Enter is a new line", async () => {
    other.focus();
    box.open(Promise.resolve("e1"), button);
    type("Export only");
    expect(key(textarea()!, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(false);
    type("\nthe filtered rows");
    expect(key(textarea()!, { key: "Enter" }).defaultPrevented).toBe(true);
    await settle();
    expect(calls).toEqual(['note e1 "Export only"', 'note e1 "Export only\\nthe filtered rows"']);
    expect(box.isOpen()).toBe(false);
    expect(hosts()).toHaveLength(0);
    expect(document.activeElement).toBe(other);
  });

  it("sends the note on every change, and again when the page is hidden or loses focus", async () => {
    box.open(Promise.resolve("e1"), button);
    type("Make");
    type(" it red");
    await settle();
    expect(calls).toEqual(['note e1 "Make"', 'note e1 "Make it red"']);
    // A change with no input event (none is expected, but nothing may be lost): the popup
    // opening as a tab hides the page, the action popup blurs it.
    textarea()!.value += " and bold";
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(calls.at(-1)).toBe('note e1 "Make it red and bold"');
    textarea()!.value += "!";
    window.dispatchEvent(new Event("blur"));
    await settle();
    expect(calls.at(-1)).toBe('note e1 "Make it red and bold!"');
    expect(box.isOpen()).toBe(true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("waits for the recorder's id before sending, and closes when the gesture was refused", async () => {
    let accept!: (id: string | undefined) => void;
    box.open(new Promise((resolve) => (accept = resolve)), button);
    type("early");
    await settle();
    expect(calls).toEqual([]);
    accept("e4");
    await settle();
    expect(calls).toEqual(['note e4 "early"']);

    box.open(Promise.resolve(undefined), other);
    await settle();
    expect(box.isOpen()).toBe(false);
  });

  it("Esc cancels the gesture itself, as Undo does", async () => {
    box.open(Promise.resolve("e2"), button);
    type("never mind");
    await settle();
    calls.length = 0;
    expect(key(textarea()!, { key: "Escape" }).defaultPrevented).toBe(true);
    await settle();
    expect(calls).toEqual(["discard e2"]);
    expect(hosts()).toHaveLength(0);
  });

  it("a press outside saves a note and cancels an empty box once the press is over, and still reaches the page", async () => {
    const pressed = vi.fn();
    document.addEventListener("pointerdown", pressed);
    box.open(Promise.resolve("e1"), button);
    type("Bigger");
    pointerdown(other);
    await settle();
    expect(calls).toEqual(['note e1 "Bigger"']);
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(box.isOpen()).toBe(false);

    box.open(Promise.resolve("e2"), other);
    pointerdown(document.body);
    expect(box.isOpen()).toBe(false);
    pointer("pointerup", document.body);
    await vi.advanceTimersByTimeAsync(GESTURE_WAIT_MS - 1);
    expect(calls).not.toContain("discard e2");
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.at(-1)).toBe("discard e2");
    document.removeEventListener("pointerdown", pressed);
  });

  it("an empty box closed by a press that becomes a selection keeps its gesture, as pointing again does", async () => {
    box.open(Promise.resolve("e1"), button);
    // A double click: two presses, and the word is selected (a new gesture) on the second.
    pointerdown(document.body);
    pointer("pointerup", document.body);
    await vi.advanceTimersByTimeAsync(GESTURE_WAIT_MS - 100);
    pointerdown(document.body);
    await vi.advanceTimersByTimeAsync(GESTURE_WAIT_MS);
    pointer("pointerup", document.body);
    box.open(Promise.resolve("e2"), other);
    await vi.advanceTimersByTimeAsync(GESTURE_WAIT_MS * 2);
    expect(calls).toEqual([]);
    expect(box.isOpen()).toBe(true);
  });

  it("a press outside an empty box followed by Stop or unload still cancels it", async () => {
    box.open(Promise.resolve("e1"), button);
    pointerdown(document.body);
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(calls).toEqual(["discard e1"]);

    box.open(Promise.resolve("e2"), button);
    pointerdown(document.body);
    box.close();
    await settle();
    expect(calls).toEqual(["discard e1", "discard e2"]);
  });

  it("pointing again saves the open box first (without a note when empty): one box at a time", async () => {
    box.open(Promise.resolve("e1"), button);
    type("first");
    box.open(Promise.resolve("e2"), other);
    expect(hosts()).toHaveLength(1);
    box.open(Promise.resolve("e3"), button);
    await settle();
    expect(calls).toEqual(['note e1 "first"']);
    expect(hosts()).toHaveLength(1);
  });

  it("keeps the keys, the text input and the clicks inside the box away from the page", async () => {
    const seen: string[] = [];
    const onWindow = (event: Event) => seen.push(`window ${event.type}`);
    const onDocument = (event: Event) => seen.push(`document ${event.type}`);
    const types = ["keydown", "keyup", "keypress", "input", "beforeinput", "focusin", "pointerdown", "mousedown", "click"];
    for (const t of types) {
      window.addEventListener(t, onWindow);
      document.addEventListener(t, onDocument, true);
    }
    box.open(Promise.resolve("e1"), button);
    const area = textarea()!;
    for (const t of ["keydown", "keyup", "keypress"]) area.dispatchEvent(new KeyboardEvent(t, { key: "/", bubbles: true, composed: true }));
    area.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true }));
    type("/");
    for (const t of ["pointerdown", "mousedown", "click"]) area.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true }));
    expect(seen).toEqual([]);
    expect(box.isOpen()).toBe(true);

    // Once the box is closed, the page gets its events again.
    key(area, { key: "Enter" });
    other.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, composed: true }));
    expect(seen).toEqual(["document keydown", "window keydown"]);
    for (const t of types) {
      window.removeEventListener(t, onWindow);
      document.removeEventListener(t, onDocument, true);
    }
  });

  it("keeps a focus trap from pulling the focus out of the box", () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="trap"><input id="trap-in"></div>');
    const trap = document.querySelector("#trap")!;
    const trapInput = document.querySelector<HTMLInputElement>("#trap-in")!;
    // Radix FocusScope's rule: focus leaving the container for a known element is pulled back.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !trap.contains(next)) trapInput.focus();
    };
    document.addEventListener("focusout", onFocusOut);
    trapInput.focus();
    box.open(Promise.resolve("e1"), trapInput);
    expect(rootOf(hosts()[0]!).activeElement).toBe(textarea());
    // A trap (or any script) moving the focus itself while the box is open: it comes back.
    trapInput.focus();
    expect(rootOf(hosts()[0]!).activeElement).toBe(textarea());
    // Closing gives it back to the app, which sees it arrive as usual.
    key(textarea()!, { key: "Enter" });
    expect(document.activeElement).toBe(trapInput);
    document.removeEventListener("focusout", onFocusOut);
  });

  it("treats the focus moving into a frame as a press outside", async () => {
    document.body.insertAdjacentHTML("beforeend", '<iframe id="frame"></iframe>');
    box.open(Promise.resolve("e1"), button);
    type("inside");
    document.querySelector<HTMLIFrameElement>("#frame")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await settle();
    expect(box.isOpen()).toBe(false);
    expect(calls).toEqual(['note e1 "inside"']);
  });

  it("is mounted inside the top-layer element the target is in (a fullscreen element here)", () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="stage"><button id="inner">Play</button></div>');
    const stage = document.querySelector("#stage")!;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: stage });
    box.open(Promise.resolve("e1"), document.querySelector("#inner")!);
    expect(hosts()[0]!.parentElement).toBe(stage);
    box.close();
    box.open(Promise.resolve("e2"), button);
    expect(hosts()[0]!.parentElement).toBe(document.documentElement);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("keeps the release of the Enter that closed the box from the app, and nothing after it", () => {
    const seen = vi.fn();
    document.addEventListener("keyup", seen);
    box.open(Promise.resolve("e1"), button);
    key(textarea()!, { key: "Enter" });
    // Released on whatever has the focus once the box is gone.
    const up = () => other.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
    up();
    expect(seen).not.toHaveBeenCalled();
    up();
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("keyup", seen);
  });

  it("does not save on the Enter that picks an IME candidate", async () => {
    box.open(Promise.resolve("e1"), button);
    key(textarea()!, { key: "Enter", isComposing: true });
    expect(box.isOpen()).toBe(true);
  });

  it("closes without a word to the recorder when Undo removed its gesture", async () => {
    box.open(Promise.resolve("e5"), button);
    await settle();
    type("half a note");
    await settle();
    calls.length = 0;
    box.undone("e4");
    expect(box.isOpen()).toBe(true);
    box.undone("e5");
    await vi.advanceTimersByTimeAsync(GESTURE_WAIT_MS);
    expect(box.isOpen()).toBe(false);
    expect(calls).toEqual([]);
  });

  it("does nothing to the page after dispose()", () => {
    box.dispose();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, composed: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", seen);
  });

  it("stays inside the viewport", () => {
    button.getBoundingClientRect = () => ({ top: 740, bottom: 760, left: 1000, right: 1060, width: 60, height: 20, x: 1000, y: 740, toJSON: () => ({}) });
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1024 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 768 });
    box.open(Promise.resolve("e1"), button);
    const element = rootOf(hosts()[0]!).querySelector<HTMLElement>(".box")!;
    const left = parseInt(element.style.left, 10);
    const width = parseInt(element.style.width, 10);
    expect(left + width).toBeLessThanOrEqual(1024 - 8);
    expect(parseInt(element.style.top, 10)).toBeLessThanOrEqual(768 - 8);
    // A phone-sized viewport: the box shrinks to fit.
    box.close();
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 280 });
    box.open(Promise.resolve("e2"), button);
    const narrow = rootOf(hosts()[0]!).querySelector<HTMLElement>(".box")!;
    expect(parseInt(narrow.style.width, 10)).toBe(264);
    expect(parseInt(narrow.style.left, 10)).toBe(8);
  });
});
