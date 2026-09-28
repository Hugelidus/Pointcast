// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, resolveSession, type ElementInfo, type SessionFile, type SourceReader } from "@pointcast/core";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { describeElement } from "./describe";
import { enclosingTemplates, parseTemplateMarker, templateInfo, withTemplateChain } from "./server-templates";

/**
 * The Django path end to end: integrations/django/tests renders a mini project with
 * pointcast-django and commits the HTML (tests/fixtures); here the extension reads the markers
 * around an element into its chain, and the core resolver finds its text in the project's
 * templates (tests/project), as `pointcast process --repo` and the MCP server would.
 */
const DJANGO = join(dirname(fileURLToPath(import.meta.url)), "../../../../integrations/django/tests");
const PROJECT = join(DJANGO, "project");
const fixture = (name: string): string => readFileSync(join(DJANGO, "fixtures", name), "utf8");

const LIST = "templates/pim/list.html";
const BASE = "templates/base.html";
const ROW = "templates/pim/partials/row.html";
const STATUS = "pim/templates/pim/partials/status.html";

function page(html: string): Document {
  return new JSDOM(html, { url: "http://127.0.0.1:8000/pim/" }).window.document;
}

function find(doc: Document, css: string, text?: string): Element {
  const found = [...doc.querySelectorAll(css)].find((el) => text === undefined || el.textContent?.trim() === text);
  if (found === undefined) throw new Error(`no ${css} ${text ?? ""}`);
  return found;
}

/** Reads project files like the CLI's repo reader: project-relative paths under PROJECT only. */
const projectReader: SourceReader = {
  async read(path) {
    if (path.split("/").includes("..")) return undefined;
    try {
      return readFileSync(join(PROJECT, path), "utf8");
    } catch {
      return undefined;
    }
  },
};

function session(elements: ElementInfo[]): SessionFile {
  return {
    schemaVersion: 2,
    id: "2026-09-28_12-00-00",
    startedAt: "2026-09-28T12:00:00.000Z",
    t0: 0,
    durationMs: 10_000,
    recorder: { extensionVersion: "0.3.0", userAgent: "test" },
    events: elements.map((element, i) => ({
      id: `e${i + 1}`,
      gesture: "point",
      tStart: 1000 * (i + 1),
      tEnd: 1000 * (i + 1),
      url: "http://127.0.0.1:8000/pim/",
      element,
    })),
  };
}

describe("parseTemplateMarker", () => {
  it("reads begin and end markers, and nothing else", () => {
    expect(parseTemplateMarker(' pointcast:begin file="templates/a.html" name="a.html" ')).toEqual({
      kind: "begin",
      file: "templates/a.html",
      name: "a.html",
    });
    expect(parseTemplateMarker(' pointcast:end file="templates/a.html" ')).toEqual({ kind: "end", file: "templates/a.html" });
    expect(parseTemplateMarker(" pointcast:begin templates/a.html ")).toBeUndefined();
    expect(parseTemplateMarker(' pointcast:begin file="" ')).toBeUndefined();
    expect(parseTemplateMarker(" a comment ")).toBeUndefined();
  });
});

describe("enclosingTemplates", () => {
  const b = (file: string) => `<!-- pointcast:begin file="${file}" name="${file.replace(/^templates\//, "")}" -->`;
  const e = (file: string) => `<!-- pointcast:end file="${file}" -->`;

  it("gives the open templates before the element, innermost first, at most 3", () => {
    const doc = page(
      `${b("templates/a.html")}<div>${b("templates/b.html")}<p>${e("templates/b.html")}</p>` +
        `${b("templates/c.html")}${b("templates/d.html")}${b("templates/e.html")}<span id="x">x</span>${e("templates/e.html")}</div>`,
    );
    expect(enclosingTemplates(find(doc, "#x")).map((t) => t.file)).toEqual(["templates/e.html", "templates/d.html", "templates/c.html"]);
    // b's end is inside the <p>, after its start: the <p> starts inside b.
    expect(enclosingTemplates(find(doc, "p")).map((t) => t.file)).toEqual(["templates/b.html", "templates/a.html"]);
  });

  it("ignores markers inside the element and after it", () => {
    const doc = page(`<div id="x">${b("templates/in.html")}<i>i</i>${e("templates/in.html")}</div>${b("templates/after.html")}`);
    expect(enclosingTemplates(find(doc, "#x"))).toEqual([]);
  });

  it("closes a begin left without its end by the end of the template around it (an HTMX swap)", () => {
    const doc = page(`${b("templates/page.html")}<ul>${b("templates/stray.html")}<li>1</li></ul>${e("templates/page.html")}<p id="x">x</p>`);
    expect(enclosingTemplates(find(doc, "#x"))).toEqual([]);
    const inside = page(`${b("templates/page.html")}<ul>${b("templates/stray.html")}<li>1</li></ul><p id="x">x</p>`);
    expect(enclosingTemplates(find(inside, "#x")).map((t) => t.file)).toEqual(["templates/stray.html", "templates/page.html"]);
  });

  it("ignores an end without a begin, and collapses the same template nested in itself", () => {
    const doc = page(`${b("templates/page.html")}${e("templates/gone.html")}${b("templates/row.html")}${b("templates/row.html")}<p id="x">x</p>`);
    expect(enclosingTemplates(find(doc, "#x")).map((t) => t.file)).toEqual(["templates/row.html", "templates/page.html"]);
  });

  it("drops what the frame parser drops: absolute paths are made project-relative (D8)", () => {
    const doc = page(`<!-- pointcast:begin file="C:/Users/ana/erp/templates/pim/x.html" name="pim/x.html" --><p id="x">x</p>`);
    expect(templateInfo(find(doc, "#x")).renderedBy?.[0].file).not.toContain("ana");
  });
});

describe("withTemplateChain", () => {
  const doc = page(`<!-- pointcast:begin file="templates/a.html" name="a.html" --><p id="x">x</p>`);
  it("keeps a framework chain as it is", () => {
    const framework = { renderedBy: [{ component: "Row", file: "src/Row.tsx", line: 3 }] };
    expect(withTemplateChain(framework, find(doc, "#x"))).toBe(framework);
  });
  it("uses the templates when the framework gives no chain, keeping its component", () => {
    const component = { framework: "react", name: "Island" };
    expect(withTemplateChain({ component }, find(doc, "#x"))).toEqual({ component, renderedBy: [{ file: "templates/a.html", component: "a.html" }] });
  });
});

describe("a page rendered by pointcast-django (integrations/django/tests/fixtures)", () => {
  const doc = page(fixture("list.html"));

  it("reads each element's templates into renderedBy, with the innermost as its django component", () => {
    const badge = describeElement(find(doc, "span.badge", "Activo"));
    expect(badge.renderedBy).toEqual([
      { file: STATUS, component: "pim/partials/status.html" },
      { file: ROW, component: "pim/partials/row.html" },
      { file: LIST, component: "pim/list.html" },
    ]);
    expect(badge.component).toEqual({ framework: "django", name: "pim/partials/status.html", file: STATUS });
    expect(describeElement(find(doc, "button", "Archivar")).renderedBy?.map((f) => f.file)).toEqual([ROW, LIST, BASE]);
    expect(describeElement(find(doc, "button", "Exportar CSV")).renderedBy?.map((f) => f.file)).toEqual([LIST, BASE]);
    // The nav is base.html's own markup: the page's template (list.html) wraps only its block.
    expect(describeElement(find(doc, "nav a", "Productos")).renderedBy?.map((f) => f.file)).toEqual([BASE]);
  });

  it("reads a partial swapped in by HTMX from the partial's own markers", () => {
    const swapped = page(fixture("list.html"));
    const old = find(swapped, "tr#product-A-100");
    // hx-swap="outerHTML" on the row: the response (the partial alone) replaces it, markers included.
    const template = swapped.createElement("template");
    template.innerHTML = fixture("row-htmx.html");
    old.replaceWith(template.content);
    const button = find(swapped, "#product-C-300 button");
    expect(describeElement(button).renderedBy?.map((f) => f.file)).toEqual([ROW, LIST, BASE]);
    expect(describeElement(find(swapped, "#product-C-300 span.badge")).renderedBy?.map((f) => f.file)).toEqual([STATUS, ROW, LIST]);
  });

  it("resolves the text in the project's templates and renders it in the spec", async () => {
    const elements = [
      describeElement(find(doc, "span.badge", "Activo")),
      describeElement(find(doc, "button", "Archivar")),
      describeElement(find(doc, "button", "Exportar CSV")),
      describeElement(find(doc, "p.total")),
      describeElement(find(doc, "p.hint")),
      describeElement(find(doc, "nav a", "Productos")),
    ];
    const resolved = await resolveSession(session(elements), projectReader, "repo");
    const locations = resolved.events.map((event) => event.element.resolved?.map(({ file, line }) => `${file}:${line}`));
    expect(locations).toEqual([
      // `{% if %}Activo{% else %}Inactivo{% endif %}`: template tags bound a literal like HTML tags.
      [`${STATUS}:1`],
      [`${ROW}:5`],
      // The `{# #}` and `{% comment %}` mentions of «Exportar CSV» are not code: one hit, not three.
      [`${LIST}:20`],
      // «Total: 2 productos»: its words before `{{ products|length }}`.
      [`${LIST}:19`],
      // Text from an include that renders no HTML (no markers): found through the include (rule 4).
      ["pim/templates/pim/partials/empty_hint.html:1"],
      [`${BASE}:9`],
    ]);

    const spec = renderMarkdown(resolved, { schemaVersion: 1, engine: "test", words: [] });
    expect(spec).toContain(`template: \`${STATUS}\``);
    expect(spec).toContain(`text at: \`${STATUS}:1\``);
    expect(spec).toContain(`within: template \`${ROW}\` ← template \`${LIST}\``);
    expect(spec).toContain(`text at: \`${LIST}:20\` — \`<button type="button" hx-get="/pim/export/">Exportar CSV</button>\``);
    expect(spec).not.toContain("<pim/");
  });
});
