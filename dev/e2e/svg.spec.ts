import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readRecorder, readSavedSession, setSettings, startFromPopup, stopFromPopup } from "./support/recorder";

/**
 * Pointing inside inline SVG (D7 note 2026-09-29) in a real Chromium, on dev/playground/chart.html:
 * an Alt+click on a bar or a star captures that bar or star (with its component, when the page
 * runs a dev build), the highlight flashes on it, a nameless line of the drawing still captures
 * the element around the chart, and an aria-hidden icon still captures its button.
 * Typed mode keeps it fast: no microphone, no speech model.
 */

const APP = `http://127.0.0.1:${PORT_A}`;
const NOTE_BOX = '[data-pointcast-ui="note"]';

test("Alt+click on SVG content points at that shape; drawing and icons point at their owner", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  await setSettings(popup, { inputMode: "typed" });
  await popup.reload();
  const app = await context.newPage();
  await app.goto(`${APP}/chart.html`);
  // What a Vue 3 dev build leaves on the element it renders, set by the page's own script (MAIN world).
  await app.addScriptTag({
    content: `
      document.querySelector(".map-layer .star").__vueParentComponent = {
        type: { __name: "StarMap", __file: "src/components/StarMap.vue" },
        parent: null,
        vnode: { ctx: null },
      };
    `,
  });
  // The flash overlay lives 400 ms: record each one's box as it is added.
  await app.evaluate(() => {
    const flashes: { width: number; height: number; top: number; left: number }[] = [];
    (window as unknown as { flashes: typeof flashes }).flashes = flashes;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof HTMLElement && node.getAttribute("data-pointcast-ui") === "flash") {
            const box = node.getBoundingClientRect();
            flashes.push({ width: box.width, height: box.height, top: box.top, left: box.left });
          }
        }
      }
    }).observe(document.documentElement, { childList: true });
  });
  const count = async () => (await readRecorder(popup)).eventCount;
  const box = app.locator(NOTE_BOX);

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator("[data-pointcast-ui] .rec")).toHaveText("Notes");

  const bar = app.locator("#sales-chart rect").nth(1);
  const star = app.locator(".map-layer .star").first();
  // The trend line has no fill: it is hit on its stroke only, here at (540, 68.5) in the drawing,
  // where the viewBox is the svg's own size.
  const trend = app.locator("#sales-chart");
  const concept = app.locator('[data-id="limites"] circle');
  const targets = [bar, star, app.locator(".map-layer .dust"), trend, app.locator("#download-chart svg path"), concept];
  for (const [i, target] of targets.entries()) {
    if (target === trend) {
      await trend.scrollIntoViewIfNeeded();
      const chart = (await trend.boundingBox())!;
      await app.keyboard.down("Alt");
      await app.mouse.click(chart.x + 540, chart.y + 68.5);
      await app.keyboard.up("Alt");
    } else {
      // force: Playwright's own hit test would refuse a click on an inner shape "covered" by its title.
      await target.click({ modifiers: ["Alt"], force: true });
    }
    await expect.poll(count).toBe(i + 1);
    await expect(box).toBeFocused();
    await app.keyboard.press("Enter");
    await expect(box).toHaveCount(0);
  }

  // The highlight is on the shape itself, not on the 600 px chart around it.
  const flashes = await app.evaluate(() => (window as unknown as { flashes: { width: number; height: number }[] }).flashes);
  const barBox = (await bar.boundingBox())!;
  const starBox = (await star.boundingBox())!;
  expect(flashes[0]?.width).toBeCloseTo(barBox.width, 0);
  expect(flashes[0]?.height).toBeCloseTo(barBox.height, 0);
  expect(flashes[1]?.width).toBeCloseTo(starBox.width, 0);

  const { sessionId } = await stopFromPopup(popup);
  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  const elements = session.events.map((event) => event.element);
  expect(elements.map((e) => `${e.tag} «${e.text || e.label || ""}» ${e.path}`)).toEqual([
    "rect «Febrero: 90» main › section[1] › … › svg#sales-chart › … › rect«Febrero: 90»",
    "circle «Límite de una función» main › section[2] › … › svg«Mapa» › g«Álgebra» › circle«Límite de una función»",
    "g «Álgebra» main › section[2] › … › svg«Mapa» › g«Álgebra»",
    "div «» main › section[1] › div",
    "button «Descargar» main › section[1] › button#download-chart",
    // A nameless circle in a <g data-id> of an <svg role="application" aria-label>: the item, not the svg.
    "g «» main › section[3] › … › svg«Mapa de conceptos» › g[data-id=limites]",
  ]);
  const [barInfo, starInfo] = elements;
  expect(elements[5]?.html).toBe('<g data-id="limites" class="concept"><circle class="star"/></g>');
  expect(elements[5]?.selector).toBe('g[data-id="limites"]');
  expect(barInfo?.html).toBe('<rect class="bar"><title>Febrero: 90</title></rect>');
  expect(barInfo?.styles).toMatchObject({ fill: "rgb(124, 58, 237)" });
  expect(starInfo?.component).toEqual({ framework: "vue", name: "StarMap", file: "src/components/StarMap.vue" });
  // Path data never leaves the page.
  expect(JSON.stringify(session)).not.toContain("M 80 80");
});
