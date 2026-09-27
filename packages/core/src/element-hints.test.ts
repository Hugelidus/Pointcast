import { describe, expect, it } from "vitest";
import { htmlAddsInformation, rootAttributes, searchHints, stylesLine } from "./element-hints";
import type { ElementInfo } from "./schema";

function el(extra: Partial<ElementInfo>): ElementInfo {
  return {
    tag: "button",
    text: "Export",
    selector: "#x",
    selectorUnique: true,
    path: "main › button",
    html: "",
    ...extra,
  };
}

describe("rootAttributes", () => {
  it("reads the first tag only, with quoted, unquoted and bare attributes", () => {
    const attributes = rootAttributes(
      `<input id=q data-testid="search" disabled title='a > b'><span id="inner">`,
    );
    expect([...attributes]).toEqual([
      ["id", "q"],
      ["data-testid", "search"],
      ["disabled", ""],
      ["title", "a > b"],
    ]);
  });
});

describe("searchHints", () => {
  it("lists id, test id, classes, CSS module component and source in order", () => {
    const hints = searchHints(
      el({
        html: '<button id="export-btn" data-testid="export" class="primary Toolbar_export__3xKz1">Export</button>',
        source: { file: "src/Toolbar.tsx", line: 8, attribute: "data-source", distance: 0 },
      }),
    );
    expect(hints).toEqual([
      "`#export-btn`",
      "data-testid `export`",
      "class `primary`",
      "CSS module `Toolbar_export` (component Toolbar)",
      "source `src/Toolbar.tsx:8`",
    ]);
  });

  it("skips generated ids and takes the id from the path when the HTML was redacted", () => {
    expect(searchHints(el({ html: '<button id=":r1:">x</button>' }))).toEqual([]);
    expect(searchHints(el({ path: "main › form › input#password", html: "" }))).toEqual([
      "`#password`",
    ]);
  });

  it("quotes a label only when it differs from the text the descriptor shows", () => {
    expect(searchHints(el({ label: "Export filtered rows" }))).toEqual([
      "label «Export filtered rows»",
    ]);
    expect(searchHints(el({ label: "Export" }))).toEqual([]);
    expect(searchHints(el({ text: "", label: "Close" }))).toEqual([]);
  });

  // PRIVACY (D8): defense in depth for a session recorded before capture normalized file paths
  // (or edited by hand) — component.file must never render as an absolute, machine-specific path.
  it("never prints a home directory or username from an old session's absolute component file", () => {
    const hints = searchHints(
      el({
        component: {
          framework: "vue",
          name: "Toolbar",
          file: "C:/Users/hugob/Desktop/my-app/src/components/Toolbar.vue",
          line: 8,
        },
      }),
    );
    const joined = hints.join(" ");
    expect(joined).not.toContain("Users/hugob");
    expect(joined).not.toContain("hugob");
    expect(joined).toContain("component `Toolbar` (vue) in `src/components/Toolbar.vue:8`");
  });
});

describe("stylesLine", () => {
  it("is one code span without zero or auto values", () => {
    expect(stylesLine({ color: "red", margin: "0px", width: "auto", "font-size": "14px" })).toBe(
      "`color: red; font-size: 14px`",
    );
    expect(stylesLine({ margin: "0px" })).toBeUndefined();
    expect(stylesLine(undefined)).toBeUndefined();
  });
});

describe("htmlAddsInformation", () => {
  it("is false when the hints already say everything", () => {
    expect(htmlAddsInformation(el({ html: "<th>Quantity</th>" }))).toBe(false);
    expect(
      htmlAddsInformation(el({ html: '<button type="button" class="x"><svg/> Export</button>' })),
    ).toBe(false);
    expect(htmlAddsInformation(el({ html: "" }))).toBe(false);
  });

  it("is true for unlisted attributes or child elements", () => {
    expect(htmlAddsInformation(el({ html: '<button aria-expanded="false">Menu</button>' }))).toBe(
      true,
    );
    expect(htmlAddsInformation(el({ html: "<ul><li>One</li></ul>" }))).toBe(true);
  });
});
