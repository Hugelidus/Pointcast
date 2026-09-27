import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { CapturedEvent, ElementInfo, SessionFile } from "../packages/core/src/schema";
import { measureDelay } from "./support/audio-sync";
import { expect, test } from "./support/fixtures";
import { readSpokenWords, startsOf } from "./support/ground-truth";
import { FIXTURE_WAV, PORT_A, REPO_ROOT } from "./support/paths";
import { readSavedSession, setSettings, startFromPopup, stopFromPopup } from "./support/recorder";
import {
  altClickAt,
  CANARY,
  center,
  drag,
  INDICATOR,
  Scenario,
  sleepUntil,
  textBox,
  type ExpectedEvent,
} from "./support/scenario";
import { readMonoSamples } from "./support/wav-file";

/**
 * The whole capture path in a real Chromium: the fake microphone plays fixtures/audio/es-short.wav
 * ("Esto me gustaría que estuviera filtrado por cantidad, y además esto que exporte solo lo
 * filtrado.") and the test points at the table exactly when each "esto" starts, like a person
 * narrating, then exercises the D7 gestures across a full page load and an SPA route change.
 *
 * Set POINTCAST_SAVE_FIXTURE=1 to copy the clean session to fixtures/sessions/e2e-es/ (the
 * example the CLI is developed against); by default the committed example is left untouched.
 */

const APP = `http://127.0.0.1:${PORT_A}`;
const GROUND_TRUTH = path.join(REPO_ROOT, "fixtures", "audio", "es-short.words.json");
const FIXTURE_OUT = path.join(REPO_ROOT, "fixtures", "sessions", "e2e-es");

/** How late a timed gesture may land after its schedule (Playwright → CDP → renderer latency). */
const MAX_SCHEDULE_OFFSET_MS = 150;

/** Strings the privacy scenario puts in the page that must never reach a session file (D8, plan step 8). */
const FORBIDDEN = [CANARY, "Jane Doe", "Private note", "Default textarea content"];

const EXPORT_SOURCE = { file: "src/components/Toolbar.tsx", line: 8, attribute: "data-source", distance: 1 };

interface ScenarioRun {
  scenario: Scenario;
  folder: string;
  session: SessionFile;
}

test.describe("capture on the playground with the es-short narration", () => {
  // Two recordings of ~12-20 s each plus the build-free setup.
  test.setTimeout(90_000);

  test.beforeAll(() => {
    // Without the spoken fixture the fake microphone plays a tone and nothing here makes sense.
    expect(existsSync(FIXTURE_WAV), `${FIXTURE_WAV} is missing: run scripts/tts/generate.ps1`).toBe(true);
  });

  test("gestures, order, times, URLs and element descriptions", async ({ context, extensionPage: popup, downloadsDir }) => {
    const app = await context.newPage();
    const { scenario, folder, session } = await record(app, popup, downloadsDir, { canary: false });

    assertEvents(session.events, scenario.expected, "exact");
    assertUiNeverCaptured(session.events);
    assertPrivacy(folder);
    reportOffsets(session.events, scenario.expected, folder);

    if (process.env["POINTCAST_SAVE_FIXTURE"] === "1") {
      mkdirSync(FIXTURE_OUT, { recursive: true });
      for (const file of ["audio.wav", "session.json"]) copyFileSync(path.join(folder, file), path.join(FIXTURE_OUT, file));
      console.log(`saved the session to ${FIXTURE_OUT}`);
    }
  });

  test("privacy canary: typed secrets, sensitive and form text never reach the session", async ({
    context,
    extensionPage: popup,
    downloadsDir,
  }) => {
    const app = await context.newPage();
    const { scenario, folder, session } = await record(app, popup, downloadsDir, { canary: true });

    // The canary part adds events of its own; everything else must still be there, in order.
    assertEvents(session.events, scenario.expected, "in-order");
    assertUiNeverCaptured(session.events);
    // The canary part really pointed at the secrets: selections around them and sensitive elements.
    const canaryEvents = session.events.filter((e) => e.element.path.includes("form#settings-form") || e.element.tag === "form");
    expect(canaryEvents.filter((e) => e.gesture === "select").length).toBeGreaterThanOrEqual(2);
    expect(canaryEvents.some((e) => e.element.sensitive === true)).toBe(true);
    assertPrivacy(folder);
  });
});

test("control: without a recording, Alt+click on a link is left to Chrome, which downloads it", async ({
  context,
  extensionPage: popup,
}) => {
  // Proves the "no download" check of the scenario is not vacuous: headless Chrome really does
  // save the target of an Alt+clicked link (into the temporary downloads folder), and pointcast
  // does not interfere with the page when it is not recording.
  const app = await context.newPage();
  await app.goto(`${APP}/index.html`);
  await app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Customers" }).click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await popup.evaluate(() => chrome.downloads.search({}))).map((d) => d.url)).toEqual([
    `${APP}/other.html`,
  ]);
  expect(new URL(app.url()).pathname).toBe("/index.html");
});

// --------------------------------------------------------------------------------- scenario

async function record(
  app: Page,
  popup: Page,
  downloadsDir: string,
  { canary }: { canary: boolean },
): Promise<ScenarioRun> {
  const [esto1, esto2] = startsOf(readSpokenWords(GROUND_TRUTH), "esto");
  if (esto1 === undefined || esto2 === undefined) throw new Error("es-short must say \"esto\" twice");

  await app.goto(`${APP}/index.html`);
  // reportOffsets() reads audio.wav, which is only saved when the audio is kept.
  await setSettings(popup, { keepAudio: true });
  const t0 = await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  const scenario = new Scenario(app, t0);

  // Layout is read before the first word so the timed part is only the press itself.
  const quantity = await textBox(app.getByRole("columnheader", { name: "Quantity" }));
  const exportButton = await center(app.locator("#export-btn"));
  const lead = t0 + esto1 - Date.now();
  if (lead < 100) throw new Error(`setup took too long: only ${lead} ms left before the first "esto"`);

  // "Esto me gustaría que estuviera filtrado por cantidad" → select the Quantity header.
  await scenario.gesture(
    {
      label: 'drag-select "Quantity" on the first "esto"',
      gesture: "select",
      element: { tag: "th", text: "Quantity" },
      selectionText: "Quantity",
      scheduledMs: esto1,
    },
    () => drag(app, { x: quantity.left + 1, y: quantity.midY }, { x: quantity.right - 1, y: quantity.midY }, t0 + esto1),
  );
  // "y además esto que exporte solo lo filtrado" → point at Export without exporting.
  await scenario.gesture(
    {
      label: 'Alt+click Export on the second "esto"',
      gesture: "point",
      element: { tag: "button", text: "Export", selector: "#export-btn", source: EXPORT_SOURCE },
      scheduledMs: esto2,
    },
    () => altClickAt(app, exportButton, t0 + esto2),
  );
  // Visual feedback on the captured element, gone after ~400 ms; the app did not react.
  await expect(app.locator('[data-pointcast-ui="flash"]')).toHaveCount(1);
  await expect(app.locator('[data-pointcast-ui="flash"]')).toHaveCount(0);
  await expect(app.locator("#toast")).toHaveText("");
  // The popup confirms what landed, from the described element (not a synthetic draft).
  await expect(popup.locator("#last-event")).toHaveText("Last: button «Export» · Alt+click");

  const rows = app.locator("#orders-table tbody tr");
  await expect(rows).toHaveCount(4);
  // Plain click: no longer recorded (D7, 2026-09-26), but the app still reacts normally.
  await rows.nth(0).getByRole("button", { name: "Delete" }).click();
  await expect(rows).toHaveCount(3);
  await expect(app.getByRole("cell", { name: "#1001" })).toHaveCount(0);

  await scenario.gesture({ label: "Alt+click Delete on #1002", gesture: "point", element: { tag: "button", text: "Delete" } }, () =>
    rows.nth(0).getByRole("button", { name: "Delete" }).click({ modifiers: ["Alt"] }),
  );
  await app.waitForTimeout(200);
  await expect(rows).toHaveCount(3);
  await expect(app.getByRole("cell", { name: "#1002" })).toHaveCount(1);

  if (canary) await privacyCanary(scenario, popup);

  const customers = app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Customers" });
  await scenario.gesture({ label: "Alt+click the Customers link", gesture: "point", element: { tag: "a", text: "Customers" } }, () =>
    customers.click({ modifiers: ["Alt"] }),
  );
  await app.waitForTimeout(500);
  // Neither followed nor downloaded (Chrome saves the target of an Alt+clicked link; D7).
  expect(new URL(app.url()).pathname).toBe("/index.html");
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([]);

  // Plain clicks below: none of them are recorded (D7, 2026-09-26); the app still reacts and
  // navigates normally, exactly as if pointcast were not there.
  await customers.click();
  await scenario.waitForPage("/other.html");

  await app.getByRole("button", { name: "View orders" }).first().click();
  await app.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "SPA demo" }).click();
  await scenario.waitForPage("/spa.html");

  await app.getByRole("button", { name: "Reports" }).click();
  await app.waitForURL((u) => u.search === "?view=/reports");
  await scenario.gesture({ label: "Alt+click the Status header", gesture: "point", element: { tag: "th", text: "Status" } }, () =>
    app.getByRole("columnheader", { name: "Status" }).click({ modifiers: ["Alt"] }),
  );

  // Stop once the narration has played through (the fake microphone loops it), so audio.wav
  // holds the whole sentence exactly once: a clean example for the CLI.
  const narration = readMonoSamples(readFileSync(FIXTURE_WAV));
  await sleepUntil(t0 + (narration.samples.length * 1000) / narration.sampleRate + 200);
  const { sessionId } = await stopFromPopup(popup);
  const { folder, session } = await readSavedSession(popup, downloadsDir, sessionId);
  expect(session.t0).toBe(t0);
  return { scenario, folder, session };
}

/**
 * Plan step 8: type the canary into Password, API token and Card number, then click, point and
 * select around them. Recorded but not listed in `expected`: which of these produce an event
 * (a drag inside an input selects nothing in the document) is not what this test is about.
 * The instructions aside quotes the canary on purpose and is never touched.
 */
async function privacyCanary(scenario: Scenario, popup: Page): Promise<void> {
  const { page } = scenario;
  for (const id of ["password", "api-token", "card-number"]) {
    const field = page.locator(`#${id}`);
    await field.click();
    await field.pressSequentially(CANARY);
    await expect(field).toHaveValue(CANARY);
  }
  for (const name of ["Password", "API token", "Card number"]) {
    await page.locator("#settings-form label").filter({ hasText: name }).click();
  }
  for (const css of ["#display-name", "#password", "#api-token", "#card-number", "#comment", ".private-note"]) {
    await page.locator(css).click({ modifiers: ["Alt"] });
    if (css === "#password") {
      // A sensitive element is summarized by tag and label only: never its value (D8).
      await expect(popup.locator("#last-event")).toHaveText("Last: input «Password» · Alt+click");
    }
  }
  await page.locator("#settings-form").click({ modifiers: ["Alt"], position: { x: 2, y: 2 } });
  await page.locator("#display-name").click();

  // Across the secret fields: from the "Password" label to the end of the card number field.
  const passwordLabel = await textBox(page.locator('label[for="password"]'));
  const card = page.locator("#card-number");
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("card number field has no box");
  await drag(
    page,
    { x: passwordLabel.left + 1, y: passwordLabel.midY },
    { x: cardBox.x + cardBox.width - 2, y: cardBox.y + cardBox.height / 2 },
  );
  // The whole settings section, from its heading to the Save button.
  const heading = await textBox(page.getByRole("heading", { name: "Settings" }));
  const save = await center(page.getByRole("button", { name: "Save" }));
  await drag(page, { x: heading.left + 1, y: heading.midY }, { x: save.x + 20, y: save.y });
  // Word selections inside the sensitive note and inside the fields holding secrets or values.
  await page.locator(".private-note").dblclick();
  await page.locator("#password").dblclick();
  await page.locator("#display-name").dblclick();
  await page.locator("#comment").dblclick();
  // Clear any selection so the next gesture starts clean.
  await page.getByRole("heading", { name: "Orders", level: 1 }).click();
}

// ------------------------------------------------------------------------------- assertions

function matches(event: CapturedEvent, expected: ExpectedEvent): boolean {
  return (
    event.gesture === expected.gesture &&
    event.url === expected.url &&
    event.element.tag === expected.element.tag &&
    event.element.text === expected.element.text
  );
}

/**
 * "exact": the session holds exactly the expected events, in order.
 * "in-order": the expected events appear in order, possibly with others in between.
 */
function assertEvents(events: CapturedEvent[], expected: ExpectedEvent[], mode: "exact" | "in-order"): void {
  if (mode === "exact") {
    expect(events.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}»`)).toEqual(
      expected.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}»`),
    );
  }
  let next = 0;
  for (const want of expected) {
    const found = events.findIndex((e, i) => i >= next && matches(e, want));
    expect(found, `${want.label}: no matching event after e${next}`).toBeGreaterThanOrEqual(0);
    const event = events[found] as CapturedEvent;
    next = found + 1;

    expect(event.url, want.label).toBe(want.url);
    expect(event.element, want.label).toMatchObject(want.element);
    if (want.selectionText !== undefined) expect(event.selection?.text, want.label).toBe(want.selectionText);
    else expect(event.selection, want.label).toBeUndefined();
    expect(event.tStart, `${want.label}: tStart`).toBeGreaterThanOrEqual(want.window[0]);
    expect(event.tStart, `${want.label}: tStart`).toBeLessThanOrEqual(want.window[1]);
    expect(event.tEnd, `${want.label}: tEnd`).toBeLessThanOrEqual(want.window[1]);
    if (want.scheduledMs !== undefined) {
      const offset = event.tStart - want.scheduledMs;
      expect(offset, `${want.label}: offset from schedule`).toBeGreaterThanOrEqual(0);
      expect(offset, `${want.label}: offset from schedule`).toBeLessThanOrEqual(MAX_SCHEDULE_OFFSET_MS);
    }
  }

  // Every described element must be findable again by its selector (D3).
  const described = events.flatMap((e) => [e.element, e.selection?.start, e.selection?.end]);
  for (const element of described.filter((el): el is ElementInfo => el !== undefined)) {
    expect(element.selectorUnique, element.selector).toBe(true);
  }
  // The SPA route is visible in the URLs (plan step 9).
  expect(events.map((e) => e.url)).toContain(`${APP}/spa.html?view=/reports`);
}

/** The REC badge and the highlight flash are pointcast's own UI: never an event, never in HTML. */
function assertUiNeverCaptured(events: CapturedEvent[]): void {
  const json = JSON.stringify(events);
  expect(json).not.toContain("pointcast");
  expect(json).not.toContain("REC");
}

/**
 * Reads every file of the session folder as bytes, the transcript and the Markdown included:
 * nothing forbidden may appear anywhere.
 */
function assertPrivacy(folder: string): void {
  const files = readdirSync(folder);
  expect(files.sort()).toEqual(["audio.wav", "session.json", "session.md", "words.json"]);
  for (const file of files) {
    const bytes = readFileSync(path.join(folder, file));
    for (const secret of FORBIDDEN) {
      expect(bytes.includes(Buffer.from(secret, "utf8")), `"${secret}" found in ${file}`).toBe(false);
    }
  }
}

/**
 * Prints how far each timed gesture landed from its schedule, and from the spoken word as it
 * really is in audio.wav (the fake microphone does not start exactly at t0, see audio-sync.ts).
 */
function reportOffsets(events: CapturedEvent[], expected: ExpectedEvent[], folder: string): void {
  const audio = measureDelay(
    readMonoSamples(readFileSync(path.join(folder, "audio.wav"))),
    readMonoSamples(readFileSync(FIXTURE_WAV)),
  );
  // A clear match proves the narration really went through the recorder into audio.wav.
  expect(audio.correlation).toBeGreaterThan(0.5);
  const rows = expected
    .filter((want) => want.scheduledMs !== undefined)
    .map((want) => {
      const event = events.find((e) => matches(e, want)) as CapturedEvent;
      const scheduled = want.scheduledMs as number;
      return {
        gesture: want.label,
        scheduledMs: scheduled,
        tStart: event.tStart,
        tEnd: event.tEnd,
        offsetFromScheduleMs: event.tStart - scheduled,
        wordInAudioMs: scheduled + audio.delayMs,
        offsetFromWordInAudioMs: event.tStart - (scheduled + audio.delayMs),
      };
    });
  console.log(`narration delay in audio.wav: ${audio.delayMs} ms (envelope correlation ${audio.correlation.toFixed(2)})`);
  console.table(rows);
  // Plan step 10's bar for the single clock: event times within 0.4 s of the spoken word.
  for (const row of rows) expect(Math.abs(row.offsetFromWordInAudioMs), row.gesture).toBeLessThan(400);
}
