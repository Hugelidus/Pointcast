import type { Download, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readRecorder, readSavedSession, setSettings, startFromPopup, stopFromPopup } from "./support/recorder";
import { center } from "./support/scenario";

/**
 * Alt+click (⌥ Option+click on macOS, where Chrome maps Alt to Option) has default actions of
 * its own: Chrome DOWNLOADS the target of an Alt+clicked link, on every platform, and a click on
 * a submit button submits its form. While recording, pointing at any of them must do nothing but
 * point (D7): the gesture is captured, and nothing is followed, downloaded or submitted. Also on
 * links inside open and closed shadow roots, and for Alt+middle-click (auxclick), which opens a
 * link in a new tab.
 *
 * Frames are out of scope: the content script runs in the top frame only (allFrames is false,
 * background/site-scripts.ts), so an Alt+click inside an <iframe> is left to Chrome.
 *
 * Typed mode keeps it fast (no microphone, no speech model) and adds the note box to the check: on
 * macOS, Option is still held right after the click that opens the box, and Option+letter types
 * special characters, so the box must not depend on the Alt state.
 */

const APP = `http://127.0.0.1:${PORT_A}`;
const NOTE_BOX = '[data-pointcast-ui="note"]';

/** Links, a form and web components with a link inside, added to the playground's index page. */
async function addTargets(app: Page): Promise<void> {
  await app.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<section id="targets" aria-label="Alt-click targets">' +
        '<a id="plain-link" href="/file.txt">file.txt</a> ' +
        '<a id="download-link" href="/file.txt" download="notes.txt">Download notes</a>' +
        '<form id="send-form" action="/other.html"><input name="q" value="x" aria-label="Query">' +
        '<button id="send-btn" type="submit">Send form</button>' +
        '<input id="send-input" type="submit" value="Submit input"></form>' +
        '<x-open id="open-host"></x-open> <x-closed id="closed-host"></x-closed>' +
        "</section>",
    );
    const inShadow = (id: string, mode: ShadowRootMode, text: string) => {
      const root = document.getElementById(id)!.attachShadow({ mode });
      root.innerHTML = `<a href="/file.txt" download style="display:inline-block;padding:4px">${text}</a>`;
    };
    inShadow("open-host", "open", "Shadow download");
    inShadow("closed-host", "closed", "Closed download");
  });
}

/**
 * What the app would react to: its own mouse listeners and form submits. Added once recording
 * runs, since capture's window listeners are added when a recording starts (capture-controller.ts):
 * an app listener on window in the capture phase added BEFORE that runs first and sees the events,
 * though their default action (the download, the navigation) is still cancelled.
 */
async function watchApp(app: Page): Promise<void> {
  await app.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) {
      window.addEventListener(type, (event) => seen.push(`window ${type} ${(event as MouseEvent).button}`), true);
      document.addEventListener(type, (event) => seen.push(`document ${type} ${(event as MouseEvent).button}`), true);
    }
    document.addEventListener("submit", () => seen.push("submit"), true);
  });
}

const appSaw = (app: Page) => app.evaluate(() => (window as unknown as { seen: string[] }).seen.slice());

/** Downloads Chrome started, as the extension's downloads API sees them (the session is not saved yet). */
const chromeDownloads = (popup: Page) =>
  popup.evaluate(async () => (await chrome.downloads.search({})).map((d) => new URL(d.url).pathname).sort());

test("while recording, Alt+click on links, download links, submit buttons and shadow DOM only points", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  await setSettings(popup, { inputMode: "typed" });
  await popup.reload();
  const app = await context.newPage();
  const downloads: Download[] = [];
  app.on("download", (download) => downloads.push(download));
  await app.goto(`${APP}/index.html`);
  await addTargets(app);
  const box = app.locator(NOTE_BOX);
  const count = async () => (await readRecorder(popup)).eventCount;

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator("[data-pointcast-ui] .rec")).toHaveText("Notes");
  await watchApp(app);

  // ---- A plain link, with Alt still held when the box opens (as a Mac user holds Option): the
  // box takes the focus, the release of Alt does not close it, and the note is typed as usual.
  const plain = await center(app.locator("#plain-link"));
  await app.mouse.move(plain.x, plain.y);
  await app.keyboard.down("Alt");
  await app.mouse.click(plain.x, plain.y);
  await expect(box).toBeFocused();
  await expect.poll(count).toBe(1);
  await app.keyboard.up("Alt");
  await expect(box).toBeFocused();
  // Characters a Mac types with Option (é, ñ, ¿, ©): Playwright inserts them as text, as macOS does.
  await app.keyboard.type("Rename to «notes» — ¿é, ñ, ©?");
  // Option still held on Enter: it saves all the same.
  await app.keyboard.press("Alt+Enter");
  await expect(box).toHaveCount(0);

  // ---- A link with the download attribute, a submit <button> and an <input type=submit>.
  await app.locator("#download-link").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(2);
  await expect(box).toBeFocused();
  await app.locator("#send-btn").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(3);
  await app.locator("#send-input").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(4);

  // ---- Download links inside an open shadow root (Playwright's CSS pierces it) and a closed one
  // (seen from window as its host only: the host is what gets described, and still cancelled).
  await app.locator("#open-host a").click({ modifiers: ["Alt"] });
  await expect.poll(count).toBe(5);
  const closed = await center(app.locator("#closed-host"));
  await app.mouse.move(closed.x, closed.y);
  await app.keyboard.down("Alt");
  await app.mouse.click(closed.x, closed.y);
  await app.keyboard.up("Alt");
  await expect.poll(count).toBe(6);
  await app.keyboard.press("Enter");
  await expect(box).toHaveCount(0);

  // ---- Alt+middle-click: cancelled too (no new tab, no download), and not a gesture.
  const pagesBefore = context.pages().length;
  await app.locator("#plain-link").click({ button: "middle", modifiers: ["Alt"] });

  // Give a download or a navigation the time to start, then check none did.
  await app.waitForTimeout(1_000);
  expect(new URL(app.url()).pathname).toBe("/index.html");
  expect(context.pages()).toHaveLength(pagesBefore);
  expect(downloads.map((d) => d.url())).toEqual([]);
  expect(await chromeDownloads(popup)).toEqual([]);
  // The app saw no press, release or click of any Alt gesture, and no submit. (The middle button's
  // own press and release are not a gesture and reach it; its auxclick does not.)
  expect((await appSaw(app)).filter((line) => !/(pointer|mouse)(down|up) 1$/.test(line))).toEqual([]);
  expect(await count()).toBe(6);

  const { sessionId } = await stopFromPopup(popup);
  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.events.map((e) => `${e.id} ${e.gesture} ${e.element.tag} «${e.element.text ?? ""}»`)).toEqual([
    "e1 point a «file.txt»",
    "e2 point a «Download notes»",
    "e3 point button «Send form»",
    expect.stringMatching(/^e4 point input /),
    "e5 point a «Shadow download»",
    expect.stringMatching(/^e6 point x-closed /),
  ]);
  expect(session.events[0]?.note).toBe("Rename to «notes» — ¿é, ñ, ©?");
});

test("control: without a recording, Alt+click on a download link is left to Chrome, which downloads it", async ({
  context,
  extensionPage: popup,
}) => {
  // Proves the checks above are not vacuous: the same page, the same clicks, no recording.
  const app = await context.newPage();
  const downloads: Download[] = [];
  app.on("download", (download) => downloads.push(download));
  await app.goto(`${APP}/index.html`);
  await addTargets(app);
  await app.locator("#download-link").click({ modifiers: ["Alt"] });
  await expect.poll(() => chromeDownloads(popup)).toEqual(["/file.txt"]);
  expect(downloads.map((d) => new URL(d.url()).pathname)).toEqual(["/file.txt"]);
  // Chrome applies Alt to the navigation of a form submission as well: it downloads the response.
  await app.locator("#send-btn").click({ modifiers: ["Alt"] });
  await expect.poll(() => chromeDownloads(popup)).toEqual(["/file.txt", "/other.html"]);
  expect(new URL(app.url()).pathname).toBe("/index.html");
});
