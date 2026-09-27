import { UI_ATTRIBUTE, type CapturedEventDraft, type Gesture, type SelectionInfo } from "@pointcast/core";
import { describeElement } from "./describe";
import { isShadowRoot } from "./dom";
import { DEFAULT_CAPTURE_OPTIONS, type CaptureOptions } from "./options";
import { redactPersonalText, redactPersonalUrl } from "./personal";
import { boundaryElement, readRange } from "./selection";
import { readStyles } from "./styles";
import { redactUrl } from "./url";

/**
 * Receives each captured event as soon as it happens (D6: send immediately so nothing is lost
 * when the page unloads). `target` is the live element that was described, e.g. to flash a
 * highlight on it; it must not be serialized.
 */
export type EmitCapturedEvent = (draft: CapturedEventDraft, target: Element) => void;

/** Tags whose selections are "too large to describe" regardless of their size (D5). */
const LARGE_CONTAINER_TAGS = new Set(["html", "body", "main"]);

interface RangeSnapshot {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

type SelectionRoot = ShadowRoot & { getSelection?: () => Selection | null };

/** The open shadow roots an event passed through, innermost first. */
function shadowRootsOf(event: Event): SelectionRoot[] {
  return event.composedPath().filter((node) => isShadowRoot(node as Node)) as SelectionRoot[];
}

/**
 * The selection a gesture made. Chrome keeps a selection made inside a shadow tree on that
 * shadow root (ShadowRoot.getSelection, Chrome-only); document.getSelection() then reports a
 * range on <body> (verified in Chromium 153). So the given shadow roots are asked first.
 */
function activeSelection(doc: Document, roots: readonly SelectionRoot[]): Selection | null {
  for (const root of roots) {
    const selection = typeof root.getSelection === "function" ? root.getSelection() : null;
    if (selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) return selection;
  }
  return doc.getSelection();
}

function snapshotSelection(selection: Selection | null): RangeSnapshot | undefined {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const { startContainer, startOffset, endContainer, endOffset } = selection.getRangeAt(0);
  return { startContainer, startOffset, endContainer, endOffset };
}

function sameRange(a: RangeSnapshot | undefined, b: Range): boolean {
  return (
    a !== undefined &&
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
}

/** Stops the event for the page: no default action, no app listener, not even on window. */
function cancel(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/**
 * The element a mouse event is about. Clicks on an icon land on an inner <path>; the element
 * that owns the icon (usually a button or link) is what the user meant. composedPath()[0] is
 * the real target inside an open shadow root, where event.target seen from window is the host.
 */
function eventElement(event: Event): Element | null {
  const target = (event.composedPath()[0] ?? event.target) as Node | null;
  if (target === null || typeof target.nodeType !== "number") return null; // window/document
  const el = boundaryElement(target);
  const svg = el?.closest("svg");
  return svg ? (svg.parentElement ?? svg) : el;
}

function isPointcastUi(el: Element | null): boolean {
  return el !== null && el.closest(`[${UI_ATTRIBUTE}]`) !== null;
}

/**
 * Starts recording pointing gestures in `doc` and returns a function that stops it (D7):
 * - Alt+click → `point`; the whole press is cancelled so the app never reacts and Chrome
 *   neither follows nor downloads a link.
 * - Drag or double-click text selection → `select` from press to release.
 * - Plain click → nothing is recorded; the click reaches the app untouched, exactly as if
 *   pointcast were not there (only deliberate gestures are captured, see D7).
 * Listeners sit on window in the capture phase, so they run before any app listener and an
 * app calling stopPropagation cannot hide events from them.
 */
export function startCapture(
  doc: Document,
  emit: EmitCapturedEvent,
  options: Partial<CaptureOptions> = {},
): () => void {
  const settings: CaptureOptions = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
  const win = doc.defaultView;
  if (win === null) throw new Error("startCapture needs a document attached to a window");

  // One gesture = press … release … click. Pointer and mouse events both arrive for the same
  // press; pointer events come first and still arrive when an app cancels pointerdown (which
  // suppresses the mouse events), so whichever comes first opens the gesture.
  let phase: "idle" | "down" | "up" = "idle";
  let openedByPointer = false;
  let pressedAt = 0;
  let altGesture = false;
  let selectionAtPress: RangeSnapshot | undefined;
  // A drag that starts inside a web component often ends outside it: remember its shadow roots.
  let shadowRootsAtPress: SelectionRoot[] = [];
  let selectEmitted = false;

  const url = (): string => {
    const href = redactUrl(win.location.href);
    // On a site that is not the user's own app, the URL can name a customer as well as the page can.
    return settings.redactPersonalData ? redactPersonalUrl(href) : href;
  };

  const emitElementEvent = (gesture: Gesture, target: Element, at: number): void => {
    const element = describeElement(target, settings);
    // Styles only for the element pointed at (visual requests are about it), never for a
    // sensitive one: a computed width can hint at the length of a hidden value.
    const styles = element.sensitive ? undefined : readStyles(target);
    if (styles !== undefined) element.styles = styles;
    emit({ gesture, atStart: at, atEnd: at, url: url(), element }, target);
  };

  const beginGesture = (event: MouseEvent): void => {
    phase = "down";
    openedByPointer = event.type === "pointerdown";
    pressedAt = settings.now();
    altGesture = event.altKey;
    // Taken before the browser's default action, so a selection made by this very press
    // (drag or double-click) can be told apart from one left over from earlier.
    shadowRootsAtPress = shadowRootsOf(event);
    selectionAtPress = snapshotSelection(activeSelection(doc, shadowRootsAtPress));
    selectEmitted = false;
  };

  const onPress = (event: MouseEvent): void => {
    if (event.button !== 0 || isPointcastUi(eventElement(event))) return;
    const duplicate = event.type === "mousedown" && phase === "down" && openedByPointer;
    if (!duplicate) beginGesture(event);
    if (altGesture) cancel(event);
  };

  /** Emits a `select` for the current selection when this gesture created it. */
  const captureSelection = (event: Event): void => {
    const selection = activeSelection(doc, [...shadowRootsOf(event), ...shadowRootsAtPress]);
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (sameRange(selectionAtPress, range)) return;

    const reading = readRange(range, settings);
    const container = reading.container;
    if (container === null || isPointcastUi(container)) return;
    if (reading.text === "" && !reading.sensitive) return; // e.g. a drag inside a text field

    const releasedAt = settings.now();
    const text = settings.redactPersonalData ? redactPersonalText(reading.text) : reading.text;
    const info: SelectionInfo = { text };
    const isLarge =
      LARGE_CONTAINER_TAGS.has(container.localName) ||
      container.getElementsByTagName("*").length > settings.largeContainerElements;
    if (isLarge) {
      const start = boundaryElement(range.startContainer);
      const end = boundaryElement(range.endContainer);
      if (start !== null) info.start = describeElement(start, settings);
      if (end !== null) info.end = describeElement(end, settings);
    }
    emit(
      {
        gesture: "select",
        atStart: pressedAt,
        atEnd: releasedAt,
        url: url(),
        element: describeElement(container, settings),
        selection: info,
      },
      container,
    );
    selectEmitted = true;
  };

  const onRelease = (event: MouseEvent): void => {
    if (event.button !== 0 || phase !== "down") return;
    if (altGesture) {
      cancel(event);
      return;
    }
    phase = "up";
    if (!isPointcastUi(eventElement(event))) captureSelection(event);
  };

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const target = eventElement(event);
    if (target === null || isPointcastUi(target)) return;
    const pointing = altGesture || event.altKey;
    phase = "idle";
    altGesture = false;

    // A plain click is not recorded at all (product decision 2026-09-26, D7): it must reach the
    // app exactly as if pointcast were not there, so nothing here may cancel or describe it.
    if (pointing) {
      // Cancel before describing: if describing ever threw, the click must still not execute.
      cancel(event);
      emitElementEvent("point", target, settings.now());
    }
  };

  /** Middle-click with Alt opens links in a new tab: cancel it like the primary Alt+click. */
  const onAuxClick = (event: MouseEvent): void => {
    if (event.altKey && !isPointcastUi(eventElement(event))) cancel(event);
  };

  /**
   * Engines that select the word only after the second click would miss it on release;
   * checking again on dblclick covers them without producing a duplicate.
   */
  const onDoubleClick = (event: MouseEvent): void => {
    if (event.altKey) {
      cancel(event);
      return;
    }
    if (!selectEmitted && !isPointcastUi(eventElement(event))) captureSelection(event);
  };

  const listeners: [string, (event: MouseEvent) => void][] = [
    ["pointerdown", onPress],
    ["mousedown", onPress],
    ["pointerup", onRelease],
    ["mouseup", onRelease],
    ["click", onClick],
    ["auxclick", onAuxClick],
    ["dblclick", onDoubleClick],
  ];
  // Only the user's own input counts. Events created by page scripts are ignored entirely: not
  // recorded, not cancelled, and they do not disturb the state of a real gesture in progress
  // (an app calling a.click() from inside the user's click handler, for instance).
  const registered = listeners.map(([type, listener]): [string, EventListener] => [
    type,
    ((event: MouseEvent) => {
      if (event.isTrusted || settings.acceptUntrusted) listener(event);
    }) as EventListener,
  ]);
  for (const [type, listener] of registered) win.addEventListener(type, listener, true);
  return () => {
    for (const [type, listener] of registered) win.removeEventListener(type, listener, true);
  };
}
