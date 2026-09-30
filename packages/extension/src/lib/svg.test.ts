// @vitest-environment jsdom
import type { CapturedEventDraft } from "@pointcast/core";
import { afterEach, describe, expect, it } from "vitest";
import { startCapture } from "./capture";
import { describeElement } from "./describe";
import { pointedElement } from "./svg";
import { loadPlayground } from "./test-utils/playground";

type Win = Window & typeof globalThis;

/**
 * Pointing inside inline SVG (D7 note 2026-09-29), on dev/playground/chart.html: a bar chart
 * whose bars have a <title>, a map whose stars sit in a <g aria-label>, a nameless trend line,
 * and an aria-hidden icon in a button.
 */

const opened: { win: Win; stop: () => void }[] = [];

afterEach(() => {
  for (const { win, stop } of opened.splice(0)) {
    stop();
    win.close();
  }
});

function setup() {
  const win = loadPlayground("chart.html").window as unknown as Win;
  const doc = win.document;
  const drafts: CapturedEventDraft[] = [];
  const targets: Element[] = [];
  const stop = startCapture(
    doc,
    (draft, target) => {
      drafts.push(draft);
      targets.push(target);
    },
    { now: () => 1_000, acceptUntrusted: true },
  );
  opened.push({ win, stop });
  const q = (css: string): Element => {
    const found = doc.querySelector(css);
    if (found === null) throw new Error(`no element for ${css}`);
    return found;
  };
  /** An Alt+click as Chrome sends it; returns whether the click went through (not cancelled). */
  const altClick = (target: Element): boolean => {
    const send = (type: string) => {
      const Ctor = type.startsWith("pointer") ? win.PointerEvent : win.MouseEvent;
      return target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, button: 0, altKey: true }));
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) send(type);
    return send("click");
  };
  return { doc, drafts, targets, q, altClick };
}

describe("Alt+click inside SVG", () => {
  it("points at a bar named by its <title>, not at the element around the chart", () => {
    const { drafts, targets, q, altClick } = setup();
    const bar = q("#sales-chart rect:nth-of-type(2)");
    expect(altClick(bar)).toBe(false);
    expect(targets[0]).toBe(bar);
    expect(drafts[0]?.element).toMatchObject({
      tag: "rect",
      text: "",
      label: "Febrero: 90",
      context: "Ventas por mes",
      path: "main › section[1] › … › svg#sales-chart › … › rect«Febrero: 90»",
      html: '<rect class="bar"><title>Febrero: 90</title></rect>',
      selectorUnique: true,
    });
    expect(q(drafts[0]!.element.selector)).toBe(bar);
  });

  it("points at a named star with a readable path through the drawing", () => {
    const { drafts, targets, q, altClick } = setup();
    const star = q(".map-layer circle");
    altClick(star);
    expect(targets[0]).toBe(star);
    expect(drafts[0]?.element).toMatchObject({
      tag: "circle",
      label: "Límite de una función",
      context: "Álgebra",
      path: "main › section[2] › … › svg«Mapa» › g«Álgebra» › circle«Límite de una función»",
      html: '<circle class="star"><title>Límite de una función</title></circle>',
    });
  });

  it("points at the named group for a shape with no name of its own", () => {
    const { drafts, targets, q, altClick } = setup();
    altClick(q(".map-layer .dust"));
    expect(targets[0]).toBe(q(".map-layer g"));
    const element = drafts[0]!.element;
    expect(element).toMatchObject({ tag: "g", label: "Álgebra", path: "main › section[2] › … › svg«Mapa» › g«Álgebra»" });
    // Direct children only, with their titles; no geometry (cx, cy, r) in the html.
    expect(element.html).toBe(
      '<g aria-label="Álgebra" class="cluster"><circle class="star"><title>Límite de una función</title></circle>' +
        '<circle class="star"><title>Derivadas</title></circle><circle class="dust"/></g>',
    );
  });

  it("points at the <g data-id> item of a role=application map, not at the named svg around it", () => {
    const { drafts, targets, q, altClick } = setup();
    const item = q('[data-id="derivadas"]');
    altClick(q('[data-id="derivadas"] circle'));
    expect(targets[0]).toBe(item);
    expect(drafts[0]?.element).toMatchObject({
      tag: "g",
      text: "",
      context: "Mapa de conceptos",
      path: "main › section[3] › … › svg«Mapa de conceptos» › g[data-id=derivadas]",
      html: '<g data-id="derivadas" class="concept"><circle class="star"/></g>',
      selector: 'g[data-id="derivadas"]',
      selectorUnique: true,
    });
  });

  it("points at an axis label, which is visible text", () => {
    const { drafts, altClick, q } = setup();
    altClick(q("#sales-chart .axis text:nth-of-type(3)"));
    expect(drafts[0]?.element).toMatchObject({ tag: "text", text: "Mar" });
  });

  it("keeps the element around the drawing for a shape that is only drawing", () => {
    const { drafts, targets, q, altClick } = setup();
    altClick(q("#sales-chart .trend"));
    expect(targets[0]).toBe(q(".chart-layer"));
    expect(drafts[0]?.element).toMatchObject({ tag: "div", html: '<div class="chart-layer"><svg/></div>' });
  });

  it("keeps the button for an icon in it (decorative SVG)", () => {
    const { drafts, targets, q, altClick } = setup();
    altClick(q("#download-chart path"));
    expect(targets[0]).toBe(q("#download-chart"));
    expect(drafts[0]?.element).toMatchObject({ tag: "button", text: "Descargar" });
  });
});

describe("pointedElement", () => {
  const html = (markup: string): Document => {
    document.body.innerHTML = markup;
    return document;
  };

  it("keeps the owner of an aria-hidden or icon-sized drawing, even with named shapes", () => {
    const doc = html(
      '<div id="a"><svg aria-hidden="true"><circle id="c1"><title>Punto</title></circle></svg></div>' +
        '<a href="/x" id="link"><svg><circle id="c2"><title>Punto</title></circle></svg></a>',
    );
    expect(pointedElement(doc.getElementById("c1")!)).toBe(doc.getElementById("a"));
    expect(pointedElement(doc.getElementById("c2")!)).toBe(doc.getElementById("link"));
    const small = html('<div id="b"><svg><circle id="c3"><title>Punto</title></circle></svg></div>');
    small.querySelector("svg")!.getBoundingClientRect = () => ({ width: 24, height: 24 }) as DOMRect;
    expect(pointedElement(small.getElementById("c3")!)).toBe(small.getElementById("b"));
  });

  it("takes a role, a test attribute, a stable id, tabindex or a link as content; not a generated id", () => {
    const doc = html(
      '<div id="around"><svg>' +
        '<rect role="button" class="r1"/><rect data-testid="bar-a" class="r2"/><rect id="bar-b" class="r3"/>' +
        '<rect tabindex="0" class="r4"/><a href="#x"><rect class="r5"/></a><rect id=":r1:" class="r6"/>' +
        '<rect role="presentation" class="r7"/><rect aria-hidden="true" aria-label="Oculto" class="r8"/>' +
        "</svg></div>",
    );
    for (const cls of ["r1", "r2", "r3", "r4"]) {
      expect(pointedElement(doc.querySelector(`.${cls}`)!)).toBe(doc.querySelector(`.${cls}`));
    }
    expect(pointedElement(doc.querySelector(".r5")!)).toBe(doc.querySelector("svg a"));
    for (const cls of ["r6", "r7", "r8"]) expect(pointedElement(doc.querySelector(`.${cls}`)!)).toBe(doc.getElementById("around"));
  });

  it("leaves HTML inside a <foreignObject> alone", () => {
    const doc = html('<div><svg><foreignObject><p id="p">Nota</p></foreignObject></svg></div>');
    expect(pointedElement(doc.getElementById("p")!)).toBe(doc.getElementById("p"));
  });
});

describe("privacy inside SVG (D8)", () => {
  it("does not read the <title> of a shape in a sensitive subtree, nor put it in the path or html", () => {
    document.body.innerHTML =
      '<main><div data-sensitive><svg aria-label="Cuenta"><g aria-label="IBAN ES91 2100"><circle id="s"><title>Saldo 4.210 €</title></circle></g></svg></div></main>';
    const info = describeElement(document.getElementById("s")!);
    expect(info.sensitive).toBe(true);
    expect(JSON.stringify(info)).not.toMatch(/Saldo|4\.210|IBAN|ES91/);
  });

  it("never reads a <title> marked sensitive itself", () => {
    document.body.innerHTML = '<main><svg><circle id="t"><title data-sensitive>secreto</title></circle></svg></main>';
    const info = describeElement(document.getElementById("t")!);
    expect(JSON.stringify(info)).not.toContain("secreto");
  });

  it("keeps an SVG item's identifier out of a sensitive subtree, and out of HTML elements", () => {
    document.body.innerHTML =
      '<main><div data-sensitive><svg><g id="x" data-id="cliente-ana-perez"><circle/></g></svg></div>' +
      '<div id="h" data-id="html-row">Fila</div></main>';
    expect(JSON.stringify(describeElement(document.getElementById("x")!))).not.toContain("ana-perez");
    expect(describeElement(document.getElementById("h")!).html).toBe('<div id="h">Fila</div>');
  });

  it("redacts personal data in an SVG item's identifier on enabled sites", () => {
    document.body.innerHTML = '<main><svg><g data-id="ana@example.com"><circle/></g></svg></main>';
    const info = describeElement(document.querySelector("g")!, { redactPersonalData: true });
    expect(JSON.stringify(info)).not.toContain("ana@example.com");
  });

  it("keeps only allowlisted attributes: no geometry, styles or handlers", () => {
    document.body.innerHTML =
      '<main><svg><path id="p" d="M 0 0 L 10 10" fill="red" style="stroke: blue" onclick="go()" data-points="1,2" aria-label="Tendencia"></path></svg></main>';
    expect(describeElement(document.getElementById("p")!).html).toBe('<path id="p" aria-label="Tendencia"/>');
  });

  it("redacts personal data in an SVG label on enabled sites", () => {
    document.body.innerHTML = '<main><svg><circle id="m"><title>ana@example.com</title></circle></svg></main>';
    const info = describeElement(document.getElementById("m")!, { redactPersonalData: true });
    expect(JSON.stringify(info)).not.toContain("ana@example.com");
  });
});
