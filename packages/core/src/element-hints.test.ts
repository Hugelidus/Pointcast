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

  it("drops utility classes capture did not know yet, keeping semantic ones (pass 2)", () => {
    expect(searchHints(el({ html: '<button class="transition-all">Download</button>' }))).toEqual([]);
    expect(searchHints(el({ html: '<a href="/users" class="ring-sidebar-ring nav-link">Users</a>' }))).toEqual(["href `/users`", "class `nav-link`"]);
    expect(searchHints(el({ html: '<div class="orders-map flex p-4">x</div>' }))).toEqual(["class `orders-map`"]);
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

  // An agent must never open or edit node_modules: a library component is named by its package,
  // never by its path, in any of the forms dev builds report it (old sessions included).
  it("names a library component by its package, never by its node_modules path", () => {
    const pnpm = "node_modules/.pnpm/@radix-ui+react-primitive@2.1.3_react@19.1.0/node_modules/@radix-ui/react-primitive/dist/index.mjs";
    const hint = (file: string, framework = "react", name = "Primitive.button") =>
      searchHints(el({ component: { framework, name, file, line: 38 } }));
    expect(hint(pnpm)).toEqual(["component `Primitive.button` (react, package `@radix-ui/react-primitive`)"]);
    expect(hint("node_modules/.pnpm/flowbite-svelte@1.28.1/node_modules/flowbite-svelte/dist/tabs/TabItem.svelte", "svelte", "TabItem")).toEqual([
      "component `TabItem` (svelte, package `flowbite-svelte`)",
    ]);
    // Absolute (projectRelativePath alone would print "flowbite-svelte/dist/…") and Windows separators.
    expect(hint("C:\\Users\\hugob\\app\\node_modules\\flowbite-svelte\\dist\\tabs\\TabItem.svelte", "svelte", "TabItem")).toEqual([
      "component `TabItem` (svelte, package `flowbite-svelte`)",
    ]);
    // Vite's dependency cache, and a chunk whose package cannot be told: "library".
    expect(hint("node_modules/.vite/deps/@radix-ui_react-slot.js?v=9f1c", "react", "Slot")).toEqual([
      "component `Slot` (react, package `@radix-ui/react-slot`)",
    ]);
    expect(hint("_next/static/chunks/node_modules_@radix-ui_react-slot_dist_index_mjs_1a2b._.js", "react", "Slot")).toEqual([
      "component `Slot` (react, library)",
    ]);
    // A source attribute pointing into a library is dropped; app paths are untouched.
    const withSource = searchHints(
      el({
        component: { framework: "react", name: "Button", file: "src/components/ui/button.tsx", line: 31 },
        source: { file: pnpm, line: 38, attribute: "data-source", distance: 1 },
      }),
    );
    expect(withSource).toEqual(["component `Button` (react) in `src/components/ui/button.tsx:31`"]);
    expect(withSource.join(" ")).not.toMatch(/node_modules|\.pnpm/);
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

  it("rounds fractional pixels and keeps colors exactly (D9 note 2026-09-28, pass 2)", () => {
    const styles = {
      color: "oklch(0.129 0.042 264.695)",
      "background-color": "oklab(0.208 -0.00310889 -0.0418848)",
      padding: "8.5px 16px",
      width: "596.844px",
      height: "16px",
      "line-height": "1.5",
    };
    expect(stylesLine(styles)).toBe(
      "`color: oklch(0.129 0.042 264.695); background-color: oklab(0.208 -0.00310889 -0.0418848); padding: 9px 16px; width: 597px; height: 16px; line-height: 1.5`",
    );
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

describe("htmlAddsInformation for SVG elements", () => {
  const svg = (html: string, label?: string) =>
    htmlAddsInformation({ tag: "rect", text: "", selector: "rect", selectorUnique: true, path: "svg › rect", html, ...(label ? { label } : {}) });

  it("does not count a <title> that is the element's label", () => {
    expect(svg('<rect class="bar"><title>Enero: 120</title></rect>', "Enero: 120")).toBe(false);
    expect(svg('<rect class="bar"><title>A &amp; B</title></rect>', "A & B")).toBe(false);
  });

  it("counts a <title> that says something else, and other children", () => {
    expect(svg('<rect class="bar"><title>Enero</title></rect>', "Ventas de enero")).toBe(true);
    expect(svg('<g class="bars"><rect class="bar"/></g>')).toBe(true);
  });
});

describe("searchHints for an SVG item's identifier", () => {
  it("gives data-id as a grep key, and does not count it as extra html", () => {
    const element = {
      tag: "g",
      text: "",
      selector: 'g[data-id="limites"]',
      selectorUnique: true,
      path: "main › svg«Mapa» › g[data-id=limites]",
      html: '<g data-id="limites" class="concept"/>',
    };
    expect(searchHints(element)).toEqual(["data-id `limites`", "class `concept`"]);
    expect(htmlAddsInformation(element)).toBe(false);
  });
});
