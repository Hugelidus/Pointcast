import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, type CodeFrame, type ComponentInfo, type ElementInfo, type SessionFile } from "@pointcast/core";
import { describe, expect, it } from "vitest";
import { resolveWithRepo } from "./local";

/**
 * The scenarios of dev/examples/react-dashboard and dev/examples/vue-dashboard (their SCENARIOS.md): each
 * element as the extension captures it (React 19 frames name files only; Vue's also give the
 * element's own component file), resolved against the example's source through route 1.
 * SCENARIOS.md lists these locations, so a change to the resolver or to an example that moves one
 * fails here instead of making it wrong.
 */

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dev/examples");

interface Example {
  root: string;
  rootId: string;
  /** renderedBy of an element rendered by `component`, which is used in pages/Dashboard or App. */
  chain(component: string): CodeFrame[];
  component(name: string): ComponentInfo;
}

const REACT: Example = {
  root: `${EXAMPLES}/react-dashboard`,
  rootId: "div#root",
  chain: (component) =>
    component === "Sidebar"
      ? [{ component, file: "src/App.tsx" }, { component: "App", file: "src/main.tsx" }]
      : [{ component, file: "src/pages/Dashboard.tsx" }, { component: "Dashboard", file: "src/App.tsx" }, { component: "App", file: "src/main.tsx" }],
  component: (name) => ({ framework: "react", name }),
};

const VUE: Example = {
  root: `${EXAMPLES}/vue-dashboard`,
  rootId: "div#app",
  chain: (component) =>
    component === "Sidebar"
      ? [{ component, file: "src/App.vue" }]
      : [{ component, file: "src/pages/Dashboard.vue" }, { component: "Dashboard", file: "src/App.vue" }],
  component: (name) => ({ framework: "vue", name, file: `src/components/${name}.vue` }),
};

/**
 * Scenarios 1, 2 and 3: «View report» of the Revenue card, the Messages «3» badge, the Orders
 * «Export»; then the table cell of "Other elements": the first order's total.
 */
function scenarios(app: Example): ElementInfo[] {
  const element = (component: string, info: Omit<ElementInfo, "selectorUnique" | "component" | "renderedBy">): ElementInfo => ({
    ...info,
    selectorUnique: true,
    component: app.component(component),
    renderedBy: app.chain(component),
  });
  return [
    element("StatCard", {
      tag: "a",
      text: "View report",
      context: "Revenue · Last 30 days",
      selector: 'a[href="/reports/revenue"]',
      path: `${app.rootId} › main › section[1] › a`,
      html: '<a class="stat-link" href="/reports/revenue">View report</a>',
    }),
    element("Sidebar", {
      tag: "span",
      text: "3",
      context: "Main",
      itemLabel: "Messages",
      selector: "span.badge",
      path: `${app.rootId} › nav«Main» › ul › li[4] › span[2]`,
      html: '<span class="badge">3</span>',
    }),
    element("OrdersTable", {
      tag: "button",
      text: "Export",
      context: "Orders",
      selector: "#orders-export",
      path: `${app.rootId} › main › section › button#orders-export`,
      html: '<button type="button" id="orders-export" class="btn btn-export">Export</button>',
    }),
    element("OrdersTable", {
      tag: "td",
      text: "$128.00",
      hint: "Total",
      itemLabel: "A-1042",
      selector: "#orders-table > tbody > tr:nth-of-type(1) > td:nth-of-type(3)",
      path: `${app.rootId} › main › section › table#orders-table › tbody › tr[1] › td[3]`,
      html: "<td>$128.00</td>",
    }),
  ];
}

function sessionOf(elements: ElementInfo[]): SessionFile {
  return {
    schemaVersion: 2,
    id: "2026-09-27_18-00-00",
    startedAt: "2026-09-27T16:00:00.000Z",
    t0: 1790000000000,
    durationMs: 10000,
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events: elements.map((element, i) => ({ id: `e${i + 1}`, gesture: "point", tStart: i * 1000, tEnd: i * 1000, url: "http://127.0.0.1:5174/", element })),
  };
}

describe("examples: the code locations SCENARIOS.md lists", () => {
  it.each([
    [
      "react-dashboard",
      REACT,
      ["text src/pages/Dashboard.tsx:11", "data src/data/nav.ts:16", "text src/components/OrdersTable.tsx:22", "text src/components/OrdersTable.tsx:9"],
    ],
    [
      "vue-dashboard",
      VUE,
      ["text src/pages/Dashboard.vue:12", "data src/data/nav.ts:18", "text src/components/OrdersTable.vue:21", "text src/components/OrdersTable.vue:10"],
    ],
  ])("%s", async (_, app, expected) => {
    const result = await resolveWithRepo(sessionOf(scenarios(app)), app.root, { explicit: true });
    expect(result.status).toBe("resolved");
    const locations = result.session.events.map((event) => (event.element.resolved ?? []).map((r) => `${r.kind} ${r.file}:${r.line}`).join(", "));
    expect(locations).toEqual(expected);
    const md = renderMarkdown(result.session, { schemaVersion: 1, engine: "test", words: [] });
    expect(md).toContain("  - on screen: span «3» next to «Messages» in «Main» on `/`\n");
    expect(md).toContain("  - on screen: td «$128.00» next to «A-1042» on `/`\n");
  });
});
