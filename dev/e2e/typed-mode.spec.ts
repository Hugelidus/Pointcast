import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readE2eRecords, readRecorder, readSavedSession, setSettings, startFromPopup, stopFromPopup } from "./support/recorder";

/**
 * The note box's host. Its shadow root is closed (page scripts must not reach the note), so the
 * tests see what a page sees: the host, which is document.activeElement while the note is typed.
 */
const NOTE_BOX = '[data-pointcast-ui="note"]';

/**
 * Typed mode (D12), in the real browser: no microphone, a note box per gesture, and the spec made
 * from the notes as soon as Stop is pressed. The app must never see the keys typed into the box.
 */
test("typed mode: two notes, one cancelled with Esc, the app never sees the typing", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  // ---- The popup: Voice / Typed, remembered.
  await popup.bringToFront();
  await popup.locator('#mode input[value="typed"]').check();
  await expect
    .poll(async () => (await popup.evaluate(() => chrome.storage.local.get("settings")))["settings"])
    .toMatchObject({ inputMode: "typed" });
  await popup.reload();
  await expect(popup.locator('#mode input[value="typed"]')).toBeChecked();
  await expect(popup.locator("#pointing")).toHaveText("Alt+click or select text, then type what should change.");
  // No microphone, no speech model: nothing to announce before the first recording.
  await expect(popup.locator("#first-run")).toBeHidden();

  // ---- The app records every key event that reaches it, wherever an app would listen.
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  await app.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seenKeys: string[] }).seenKeys = seen;
    for (const type of ["keydown", "keypress", "keyup", "beforeinput", "input"]) {
      window.addEventListener(type, (event) => seen.push(`window ${type} ${(event as KeyboardEvent).key ?? ""}`));
      document.addEventListener(type, (event) => seen.push(`document ${type} ${(event as KeyboardEvent).key ?? ""}`), true);
      document.body.addEventListener(type, (event) => seen.push(`body ${type} ${(event as KeyboardEvent).key ?? ""}`));
    }
  });
  const seenKeys = () => app.evaluate(() => (window as unknown as { seenKeys: string[] }).seenKeys.slice());

  const pagesBefore = context.pages().length;
  await startFromPopup(popup);
  expect((await readRecorder(popup)).state.inputMode).toBe("typed");
  // Record opened no permission page: the microphone was never asked for.
  expect(context.pages()).toHaveLength(pagesBefore);
  await expect(popup.locator('#mode input[value="typed"]')).toBeDisabled();

  await app.bringToFront();
  await expect(app.locator("[data-pointcast-ui] .rec")).toHaveText("Notes");

  // ---- First gesture: a note, saved with Enter.
  await app.locator("#export-btn").click({ modifiers: ["Alt"] });
  const box = app.locator(NOTE_BOX);
  await expect(box).toBeFocused();
  await app.keyboard.type("This button should export only the filtered orders.");
  await app.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);

  // ---- Second: two lines (Shift+Enter), saved by pointing at the next element.
  await app.getByRole("columnheader", { name: "Quantity" }).click({ modifiers: ["Alt"] });
  await expect(box).toBeFocused();
  await app.keyboard.type("Make this column sortable");
  await app.keyboard.press("Shift+Enter");
  await app.keyboard.type("/ like the others");

  // ---- Third: pointing again saves the open box first (one box at a time); this one is then
  // cancelled with Esc, which removes its gesture.
  await app.getByRole("button", { name: "Print" }).click({ modifiers: ["Alt"] });
  await expect(box).toHaveCount(1);
  await expect(box).toBeFocused();
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(3);
  await app.keyboard.type("never mind");
  await app.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(2);

  // The app saw none of it: not the letters, not Enter, not Escape (not even their release after
  // the box closed). Only the Alt of each Alt+click, pressed before any box was open.
  expect((await seenKeys()).filter((line) => !/ (keydown|keyup) Alt$/.test(line))).toEqual([]);
  // And it is usable again: typing into its own field reaches it.
  await app.locator("#display-name").fill("");
  await app.locator("#display-name").press("X");
  await expect(app.locator("#display-name")).toHaveValue("X");
  expect(await seenKeys()).toContain("document keydown X");

  // ---- Stop: the spec at once, from the notes.
  const { sessionId, state } = await stopFromPopup(popup);
  expect(state.lastResult).toMatchObject({ copied: true, typed: true });
  await expect(popup.locator("#result-meta")).toContainText("of notes · 2 events");
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  expect(saved.session.inputMode).toBe("typed");
  expect(saved.session.audio).toBeUndefined();
  expect(saved.wav).toBeUndefined();
  expect(saved.session.events.map((e) => `${e.id} ${e.element.tag} «${e.element.text}»: ${e.note}`)).toEqual([
    "e1 button «Export»: This button should export only the filtered orders.",
    "e2 th «Quantity»: Make this column sortable\n/ like the others",
  ]);
  expect(saved.markdown).toContain("> This button should export only the filtered orders. [a]\n\n- [a] button «Export»");
  expect(saved.markdown).toContain("> Make this column sortable\n> / like the others [a]\n\n- [a] th «Quantity»");
  expect(saved.markdown).not.toContain("never mind");
  expect(saved.markdown).not.toContain("Print");

  // Same result path as a voice session: the Markdown went to the (recorded) clipboard.
  const records = await readE2eRecords(popup);
  expect(records.filter((r) => r.kind === "clipboard")).toEqual([{ kind: "clipboard", text: saved.markdown }]);
  // Nothing was transcribed, so the speech model was never loaded.
  const stats = (await popup.evaluate(() => chrome.storage.local.get("processingStats")))["processingStats"] as
    | { modelReady?: boolean }
    | undefined;
  expect(stats?.modelReady ?? false).toBe(false);
});

/**
 * The box against a hostile or merely busy page (review of D12): a click inside the box is not a
 * gesture, a selection after an empty box keeps that box's gesture, a focus trap cannot pull the
 * focus out, a box inside a modal <dialog> works (and its Esc is the box's, not the dialog's), a
 * page script cannot read the note, and a note typed right before Stop is not lost.
 */
test("typed mode: the note box inside dialogs, focus traps and a watching page", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  await setSettings(popup, { inputMode: "typed" });
  await popup.reload();
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  await app.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<dialog id="dlg"><p>Delete 3 orders?</p><button id="dlg-ok">Confirm</button></dialog>' +
        '<div id="trap"><input id="trap-in" aria-label="Draft"><button id="trap-btn">Save draft</button></div>',
    );
    // Radix FocusScope's rule: focus leaving the container for a known element is pulled back.
    const trap = document.getElementById("trap")!;
    const trapInput = document.getElementById("trap-in") as HTMLInputElement;
    document.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && trap.contains(next) === false && trap.contains(event.target as Node)) trapInput.focus();
    });
  });
  const box = app.locator(NOTE_BOX);
  const count = async () => (await readRecorder(popup)).eventCount;

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator("[data-pointcast-ui] .rec")).toHaveText("Notes");
  // A page script watching every key (window, capture phase) and every node added.
  await app.evaluate(() => {
    const spy = { keys: "", shadow: [] as (string | null)[] };
    (window as unknown as { spy: typeof spy }).spy = spy;
    window.addEventListener("keydown", (event) => (spy.keys += event.key.length === 1 ? event.key : ""), true);
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.getAttribute("data-pointcast-ui") === "note") spy.shadow.push(node.shadowRoot === null ? null : "open");
    }).observe(document, { childList: true, subtree: true });
  });

  // ---- An Alt+click inside the open box is the box's own, not a gesture on Pointcast's UI.
  await app.locator("#export-btn").click({ modifiers: ["Alt"] });
  await expect(box).toBeFocused();
  await expect.poll(count).toBe(1);
  await app.keyboard.type("Export as CSV");
  const below = await app.locator("#export-btn").boundingBox();
  if (below === null) throw new Error("no export button");
  // The box opens under its element; its textarea is a few dozen pixels into it.
  const inBox = { x: below.x + 40, y: below.y + below.height + 8 + 45 };
  expect(await app.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-pointcast-ui"), inBox)).toBe("note");
  await app.keyboard.down("Alt");
  await app.mouse.click(inBox.x, inBox.y);
  await app.keyboard.up("Alt");
  await app.keyboard.press("End");
  await app.keyboard.type(" too");
  await expect(box).toHaveCount(1);
  await app.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  expect(await count()).toBe(1);

  // ---- An empty box, then a double-click selection: pointing again keeps the first gesture.
  await app.getByRole("button", { name: "Refresh" }).click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(2);
  await expect(box).toBeFocused();
  await app.locator('section[aria-label="Order notes"] p').dblclick({ position: { x: 30, y: 8 } });
  await expect.poll(count).toBe(3);
  await expect(box).toBeFocused();
  await app.keyboard.type("second");
  await app.keyboard.press("Enter");

  // ---- A focus trap around the element: the typing still goes into the box.
  await app.locator("#trap-in").focus();
  await app.locator("#trap-btn").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(4);
  await expect(box).toBeFocused();
  await app.keyboard.type("trap note");
  await expect(app.locator("#trap-in")).toHaveValue("");
  await app.keyboard.press("Enter");

  // ---- A modal <dialog>: the box inside it can be typed into; Esc cancels the box, not the dialog.
  await app.evaluate(() => (document.getElementById("dlg") as HTMLDialogElement).showModal());
  await app.locator("#dlg-ok").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(5);
  await expect(box).toBeFocused();
  await app.keyboard.type("not this one");
  await app.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect.poll(count).toBe(4);
  expect(await app.evaluate(() => (document.getElementById("dlg") as HTMLDialogElement).open)).toBe(true);
  await app.locator("#dlg-ok").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(5);
  await app.keyboard.type("Confirm should say which orders");
  await app.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  await app.evaluate(() => (document.getElementById("dlg") as HTMLDialogElement).close());

  // ---- A note typed right before Stop, with no Enter and no pause.
  await app.getByRole("button", { name: "Print" }).click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(6);
  await app.keyboard.type("Print should open a dialog");

  // The watching page saw only closed shadow roots, and none of the letters typed (its listener
  // came after the content script's; one added before it would see them, PRIVACY.md).
  const spy = await app.evaluate(() => (window as unknown as { spy: { keys: string; shadow: (string | null)[] } }).spy);
  expect(spy.shadow.length).toBeGreaterThan(0);
  expect(spy.shadow.every((root) => root === null)).toBe(true);
  expect(spy.keys).toBe("");

  const { sessionId } = await stopFromPopup(popup);
  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  expect(saved.session.events.map((e) => `${e.id} ${e.gesture} ${e.element.tag}: ${e.note ?? "-"}`)).toEqual([
    "e1 point button: Export as CSV too",
    "e2 point button: -",
    "e3 select p: second",
    "e4 point button: trap note",
    "e5 point button: Confirm should say which orders",
    "e6 point button: Print should open a dialog",
  ]);
  expect(saved.session.events.map((e) => e.element.text)).toEqual(["Export", "Refresh", expect.any(String), "Save draft", "Confirm", "Print"]);
  expect(saved.markdown).not.toContain("Pointcast note");
  expect(saved.markdown).not.toContain("not this one");
});
