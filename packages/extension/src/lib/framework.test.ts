// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { COMPONENT_ATTRIBUTE, parseComponentInfo, parseFrameworkInfo, parseRenderedBy, requestFrameworkInfo } from "./component-bridge";
import { describeElement } from "./describe";
import { installComponentBridge, readComponent, readRenderedBy } from "./framework-main";

/**
 * jsdom has one JS world, so the MAIN-world bridge and the isolated-world caller share it here;
 * the protocol only uses the DOM (an event and an attribute), which is what both worlds share
 * in Chrome. Framework data is faked with the same property shapes the dev builds set.
 */
function page(html: string, bridge = true): Document {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "http://localhost:5173/" });
  if (bridge) installComponentBridge(dom.window as unknown as Window);
  return dom.window.document;
}

function el(doc: Document, css: string): Element {
  const found = doc.querySelector(css);
  if (found === null) throw new Error(`no element for ${css}`);
  return found;
}

function setProp(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

const requestComponent = (target: Element) => requestFrameworkInfo(target).component;

describe("Vue 3", () => {
  it("names the owning component and its file (script setup has __name)", () => {
    const doc = page('<div id="row"><button>Delete</button></div>');
    const instance = { type: { __name: "OrderRow", __file: "src/components/OrderRow.vue" }, parent: null };
    setProp(el(doc, "#row"), "__vueParentComponent", instance);
    setProp(el(doc, "button"), "__vueParentComponent", instance);
    expect(requestComponent(el(doc, "button"))).toEqual({
      framework: "vue",
      name: "OrderRow",
      file: "src/components/OrderRow.vue",
    });
  });

  it("skips anonymous instances and falls back to the file name", () => {
    const doc = page("<span>x</span>");
    const named = { type: { __file: "/app/src/Toolbar.vue" }, parent: null };
    setProp(el(doc, "span"), "__vueParentComponent", { type: {}, parent: named });
    expect(readComponent(el(doc, "span"))).toEqual({ framework: "vue", name: "Toolbar", file: "/app/src/Toolbar.vue" });
  });

  // PRIVACY (D8): Vue dev builds report __file as an absolute path on this machine, which used
  // to reach session.json and the rendered spec verbatim (the leak this test guards against).
  it("normalizes an absolute __file to a project-relative path", () => {
    const doc = page('<div id="row"><button>Delete</button></div>');
    const instance = {
      type: { __name: "LineChart", __file: "C:/Users/hugob/Desktop/my-app/src/components/va-charts/chart-types/LineChart.vue" },
      parent: null,
    };
    setProp(el(doc, "button"), "__vueParentComponent", instance);
    expect(requestComponent(el(doc, "button"))).toEqual({
      framework: "vue",
      name: "LineChart",
      file: "src/components/va-charts/chart-types/LineChart.vue",
    });
  });
});

describe("Svelte", () => {
  it("converts Svelte 4's 0-based positions (loc has char) to 1-based", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", { loc: { file: "src/lib/Card.svelte", line: 11, column: 4, char: 200 } });
    expect(requestComponent(el(doc, "p"))).toEqual({
      framework: "svelte",
      name: "Card",
      file: "src/lib/Card.svelte",
      line: 12,
      column: 5,
    });
  });

  it("keeps Svelte 5's 1-based lines as they are and makes its columns 1-based", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", { loc: { file: "src/routes/+page.svelte", line: 3, column: 4 } });
    // Its columns are still 0-based: "    <p>" starts at column 5.
    expect(readComponent(el(doc, "p"))).toMatchObject({ framework: "svelte", name: "+page", line: 3, column: 5 });
  });

  // PRIVACY (D8): same leak as Vue's __file, via Svelte's own source map location.
  it("normalizes an absolute POSIX home path to a project-relative path", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", { loc: { file: "/home/hugo/project/src/lib/Card.svelte", line: 11, column: 4, char: 200 } });
    expect(requestComponent(el(doc, "p"))).toMatchObject({ file: "src/lib/Card.svelte" });
  });
});

describe("React", () => {
  function OrdersTable(): null {
    return null;
  }

  it("walks the fiber up to the nearest named component, with _debugSource when present", () => {
    const doc = page("<table><tr><td>3</td></tr></table>");
    const component = { type: OrdersTable, return: null };
    const host = {
      type: "td",
      _debugOwner: component,
      _debugSource: { fileName: "src/OrdersTable.tsx", lineNumber: 42, columnNumber: 9 },
      return: { type: "tr", return: component },
    };
    setProp(el(doc, "td"), "__reactFiber$abc123", host);
    expect(requestComponent(el(doc, "td"))).toEqual({
      framework: "react",
      name: "OrdersTable",
      file: "src/OrdersTable.tsx",
      line: 42,
      column: 9,
    });
  });

  it("reads forwardRef and memo names; React 19 dev (no _debugSource) gives the name only", () => {
    const doc = page("<button>Save</button>");
    const memo = { $$typeof: "memo", type: { $$typeof: "forward_ref", render: function SaveButton() {} } };
    setProp(el(doc, "button"), "__reactFiber$x", { type: "button", _debugOwner: null, return: { type: memo, return: null } });
    expect(readComponent(el(doc, "button"))).toEqual({ framework: "react", name: "SaveButton" });
  });

  it("ignores production builds, whose fibers have no _debugOwner and minified names", () => {
    const doc = page("<button>Save</button>");
    setProp(el(doc, "button"), "__reactFiber$x", { type: "button", return: { type: function t() {}, return: null } });
    expect(readComponent(el(doc, "button"))).toBeUndefined();
  });

  // PRIVACY (D8): same leak as Vue's __file, via React's _debugSource.fileName.
  it("normalizes an absolute _debugSource.fileName to a project-relative path", () => {
    const doc = page("<table><tr><td>3</td></tr></table>");
    const component = { type: OrdersTable, return: null };
    const host = {
      type: "td",
      _debugOwner: component,
      _debugSource: { fileName: "C:\\Users\\hugob\\project\\src\\OrdersTable.tsx", lineNumber: 42, columnNumber: 9 },
      return: { type: "tr", return: component },
    };
    setProp(el(doc, "td"), "__reactFiber$abc123", host);
    expect(requestComponent(el(doc, "td"))).toEqual({
      framework: "react",
      name: "OrdersTable",
      file: "src/OrdersTable.tsx",
      line: 42,
      column: 9,
    });
  });
});

/** Links `items` innermost first, the way Vue instances and Svelte blocks point at their parent. */
function linked(items: object[]): object | null {
  return items.reduceRight<object | null>((parent, item) => ({ ...item, parent }), null);
}

describe("renderedBy (the app components that rendered the element)", () => {
  const FLOWBITE = "node_modules/.pnpm/flowbite-svelte@1.28.1/node_modules/flowbite-svelte/dist";

  // The «Sales Report» link of flowbite-svelte-admin, as Svelte 5 reports it (eval Stage 0).
  it("Svelte 5: keeps component tags written in app files, 1-based, collapsing a run in one file", () => {
    const doc = page("<a>Sales Report</a>");
    setProp(el(doc, "a"), "__svelte_meta", {
      loc: { file: "src/lib/More.svelte", line: 18, column: 2 },
      parent: linked([
        { type: "component", file: "src/lib/ChartWidget.svelte", line: 27, column: 4, componentTag: "More" },
        { type: "render", file: `${FLOWBITE}/card/Card.svelte`, line: 43, column: 4 },
        { type: "if", file: `${FLOWBITE}/card/Card.svelte`, line: 28, column: 2 },
        { type: "component", file: "src/lib/ChartWidget.svelte", line: 15, column: 0, componentTag: "Card" },
        { type: "component", file: "src/routes/utils/dashboard/Dashboard.svelte", line: 112, column: 4, componentTag: "ChartWidget" },
        { type: "component", file: "src/routes/(sidebar)/+page.svelte", line: 14, column: 2, componentTag: "Dashboard" },
        { type: "component", file: ".svelte-kit/generated/root.svelte", line: 54, column: 18, componentTag: "Pyramid_2" },
      ]),
    });
    expect(readRenderedBy(el(doc, "a"))).toEqual([
      { component: "More", file: "src/lib/ChartWidget.svelte", line: 27, column: 5 },
      { component: "ChartWidget", file: "src/routes/utils/dashboard/Dashboard.svelte", line: 112, column: 5 },
      { component: "Dashboard", file: "src/routes/(sidebar)/+page.svelte", line: 14, column: 3 },
    ]);
  });

  it("Svelte 5: skips a library component's own component tags and stops at 3 frames", () => {
    const doc = page("<button>Top customers</button>");
    setProp(el(doc, "button"), "__svelte_meta", {
      loc: { file: `${FLOWBITE}/tabs/TabItem.svelte`, line: 42, column: 2 },
      parent: linked([
        { type: "component", file: "src/lib/Stats.svelte", line: 55, column: 4, componentTag: "TabItem" },
        { type: "component", file: `${FLOWBITE}/tabs/Tabs.svelte`, line: 69, column: 2, componentTag: "TabList" },
        { type: "component", file: "src/lib/Stats.svelte", line: 29, column: 2, componentTag: "Tabs" },
        { type: "component", file: "/home/hugo/app/src/routes/Dashboard.svelte", line: 113, column: 4, componentTag: "Stats" },
        { type: "component", file: "src/routes/+page.svelte", line: 14, column: 2, componentTag: "Dashboard" },
        { type: "component", file: "src/routes/+layout.svelte", line: 24, column: 4, componentTag: "Layout" },
      ]),
    });
    expect(readRenderedBy(el(doc, "button"))).toEqual([
      { component: "TabItem", file: "src/lib/Stats.svelte", line: 55, column: 5 },
      { component: "Stats", file: "src/routes/Dashboard.svelte", line: 113, column: 5 },
      { component: "Dashboard", file: "src/routes/+page.svelte", line: 14, column: 3 },
    ]);
  });

  it("Svelte 4 has no parent stack: no chain", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", { loc: { file: "src/lib/Card.svelte", line: 11, column: 4, char: 200 } });
    expect(readRenderedBy(el(doc, "p"))).toBeUndefined();
  });

  /** A Vue 3 component instance: its type, its parent, and the owner that created its vnode. */
  function instance(type: object, parent: object | null, owner: object | null = parent): object {
    return { type, parent, vnode: { ctx: owner } };
  }

  // The «Export» button of vuestic-admin: the element sits in VaButton, a library component
  // passed as slot content into VaCardTitle, inside the app's RevenueReport card.
  it("Vue 3: each instance is written in its vnode owner's file; absolute files are made relative", () => {
    const doc = page("<button><span>Export</span></button>");
    const src = "C:/Users/hugob/Desktop/my-app/src";
    const app = instance({ __file: `${src}/App.vue` }, null);
    const routerView = instance({ name: "RouterView" }, app);
    const layout = instance({ __name: "AppLayout", __file: `${src}/layouts/AppLayout.vue` }, routerView);
    const vaLayout = instance({ name: "VaLayout" }, layout);
    const innerView = instance({ name: "RouterView" }, vaLayout, layout);
    const dashboard = instance({ __name: "Dashboard", __file: `${src}/pages/Dashboard.vue` }, innerView);
    const report = instance({ __name: "RevenueReport", __file: `${src}/pages/cards/RevenueReport.vue` }, dashboard);
    // A UI library that ships .vue files: its __file is in node_modules, never an app frame.
    const card = instance({ name: "VaCard", __file: "C:/Users/hugob/Desktop/my-app/node_modules/vuestic-ui/src/VaCard.vue" }, report);
    const title = instance({ name: "VaCardTitle" }, card, report);
    const button = instance({ name: "VaButton" }, title, report);
    setProp(el(doc, "span"), "__vueParentComponent", button);
    expect(readRenderedBy(el(doc, "span"))).toEqual([
      { component: "VaButton", file: "src/pages/cards/RevenueReport.vue" },
      { component: "RevenueReport", file: "src/pages/Dashboard.vue" },
      { component: "Dashboard", file: "src/layouts/AppLayout.vue" },
    ]);
  });

  it("Vue 3: slot content passed into an app component is written where the slot is filled", () => {
    const doc = page("<button>Save</button>");
    const app = instance({ __file: "src/App.vue" }, null);
    const settings = instance({ __name: "Settings", __file: "src/pages/Settings.vue" }, app);
    const appCard = instance({ __name: "AppCard", __file: "src/components/AppCard.vue" }, settings);
    const button = instance({ name: "VaButton" }, appCard, settings);
    setProp(el(doc, "button"), "__vueParentComponent", button);
    // Not "VaButton in AppCard.vue": that is the shared card, not where this button is written.
    expect(readRenderedBy(el(doc, "button"))).toEqual([
      { component: "VaButton", file: "src/pages/Settings.vue" },
      { component: "Settings", file: "src/App.vue" },
    ]);
  });

  // shadcn-vue on reka-ui: an item inside a dropdown. reka's own wrappers (Primitive, Presence,
  // the content's layers) are created by reka's code; they have no app source and must not take
  // one of the 3 places, or the chain never reaches the app's page.
  it("Vue 3: skips library components created by library code before the 3-frame cap", () => {
    const doc = page("<div>Log out</div>");
    const app = instance({ __file: "src/App.vue" }, null);
    const page_ = instance({ __name: "Settings", __file: "src/pages/Settings.vue" }, app);
    const userNav = instance({ __name: "UserNav", __file: "src/components/UserNav.vue" }, page_);
    const content = instance({ __name: "DropdownMenuContent", __file: "src/components/ui/dropdown-menu/DropdownMenuContent.vue" }, userNav);
    const rekaContent = instance({ name: "DropdownMenuContent" }, content);
    const presence = instance({ name: "Presence" }, rekaContent, rekaContent);
    const layer = instance({ name: "Primitive" }, presence, presence);
    const item = instance({ __name: "DropdownMenuItem", __file: "src/components/ui/dropdown-menu/DropdownMenuItem.vue" }, layer, userNav);
    const rekaItem = instance({ name: "DropdownMenuItem" }, item);
    const primitive = instance({ name: "Primitive" }, rekaItem, rekaItem);
    setProp(el(doc, "div"), "__vueParentComponent", primitive);
    // Before: `Primitive` in DropdownMenuItem.vue, then `Primitive` in DropdownMenuContent.vue as
    // the third frame (stand-ins: files those wrappers are not written in).
    expect(readRenderedBy(el(doc, "div"))).toEqual([
      { component: "DropdownMenuItem", file: "src/components/ui/dropdown-menu/DropdownMenuItem.vue" },
      { component: "DropdownMenuItem", file: "src/components/UserNav.vue" },
      { component: "DropdownMenuContent", file: "src/components/ui/dropdown-menu/DropdownMenuContent.vue" },
    ]);
  });

  function OrdersPage(): null {
    return null;
  }
  function DataGrid(): null {
    return null;
  }
  function Row(): null {
    return null;
  }
  function App(): null {
    return null;
  }

  it("React up to 18: the owner chain at each owner's _debugSource; library-created owners are skipped", () => {
    const doc = page("<table><tr><td>3</td></tr></table>");
    const at = (fileName: string, lineNumber: number, columnNumber: number) => ({ fileName, lineNumber, columnNumber });
    const app = { type: App, _debugOwner: null, _debugSource: at("/home/hugo/shop/src/main.tsx", 5, 3) };
    const ordersPage = { type: OrdersPage, _debugOwner: app, _debugSource: at("src/routes.tsx", 8, 3) };
    const grid = { type: DataGrid, _debugOwner: ordersPage, _debugSource: at("C:\\Users\\hugob\\shop\\src\\pages\\Orders.tsx", 20, 7) };
    // Created by the grid library's own code, which has no JSX dev transform: no _debugSource.
    const row = { type: Row, _debugOwner: grid };
    const host = { type: "td", _debugOwner: row, return: { type: Row, return: null } };
    setProp(el(doc, "td"), "__reactFiber$abc", host);
    expect(readRenderedBy(el(doc, "td"))).toEqual([
      { component: "DataGrid", file: "src/pages/Orders.tsx", line: 20, column: 7 },
      { component: "OrdersPage", file: "src/routes.tsx", line: 8, column: 3 },
      { component: "App", file: "src/main.tsx", line: 5, column: 3 },
    ]);
  });

  /** A React 19 `_debugStack`: the JSX runtime's frame, then where the element was created. */
  function debugStack(...urls: string[]): Error {
    const error = new Error("react-stack-top-frame");
    error.stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=9f1c:250:13)",
      ...urls.map((url, i) => `    at fn${i} (${url})`),
    ].join("\n");
    return error;
  }

  // The «Download» button of shadcn-admin (React 19): Button is written in the dashboard page,
  // the page itself is created by the router (a library), the router outlet in a layout.
  it("React 19: each owner's file is the first app module in its _debugStack, without a line", () => {
    const doc = page("<button>Download</button>");
    let outerReads = 0;
    const outer = { type: App, _debugOwner: null };
    Object.defineProperty(outer, "_debugStack", {
      get() {
        outerReads++;
        return debugStack("http://localhost:5173/src/main.tsx:9:5");
      },
    });
    const root = {
      type: function RootLayout() {},
      _debugOwner: outer,
      _debugStack: debugStack("http://localhost:5173/@fs/C:/Users/hugob/Desktop/mono/packages/shell/src/Root.tsx:10:5"),
    };
    const outlet = {
      type: { $typeof: "memo", type: function OutletImpl() {} },
      _debugOwner: root,
      _debugStack: debugStack("http://localhost:5173/src/routes/(auth)/route.tsx?t=1716:37:26"),
    };
    const dashboard = {
      type: function Dashboard() {},
      _debugOwner: outlet,
      _debugStack: debugStack(
        "http://localhost:5173/node_modules/.vite/deps/@tanstack_react-router.js?v=9f1c:4832:9",
        "http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=9f1c:17424:20",
      ),
    };
    const button = {
      type: { $typeof: "forward_ref", render: function Button() {} },
      _debugOwner: dashboard,
      _debugStack: debugStack(
        "http://localhost:5173/src/features/dashboard/index.tsx?t=1716:61:13",
        "http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=9f1c:17424:20",
      ),
    };
    const host = {
      type: "button",
      _debugOwner: button,
      _debugStack: debugStack("http://localhost:5173/src/components/ui/button.tsx:31:5"),
    };
    setProp(el(doc, "button"), "__reactFiber$x", host);
    expect(readRenderedBy(el(doc, "button"))).toEqual([
      { component: "Button", file: "src/features/dashboard/index.tsx" },
      { component: "OutletImpl", file: "src/routes/(auth)/route.tsx" },
      { component: "RootLayout", file: "src/Root.tsx" },
    ]);
    // A full chain stops the walk: owners past it never format their stack.
    expect(outerReads).toBe(0);
  });

  // The Chats badge of shadcn-admin: three owners written in the shared nav-group.tsx. They
  // collapse before the cap, so the chain still reaches app-sidebar.tsx (eval Stage 0).
  it("React 19: collapses same-file owners before the 3-frame cap", () => {
    const doc = page("<span>3</span>");
    const owner = (name: string, file: string, parent: object | null) => ({
      type: { displayName: name },
      _debugOwner: parent,
      _debugStack: debugStack(`http://localhost:5173/src/components/layout/${file}:1:1`),
    });
    const layout = owner("AuthenticatedLayout", "authenticated-layout.tsx", null);
    const sidebar = owner("AppSidebar", "authenticated-layout.tsx", layout);
    const group = owner("NavGroup", "app-sidebar.tsx", sidebar);
    const item = owner("SidebarMenuItem", "nav-group.tsx", group);
    const link = owner("SidebarMenuButton", "nav-group.tsx", item);
    const badge = owner("Badge", "nav-group.tsx", link);
    setProp(el(doc, "span"), "__reactFiber$x", { type: "span", _debugOwner: badge });
    expect(readRenderedBy(el(doc, "span"))).toEqual([
      { component: "Badge", file: "src/components/layout/nav-group.tsx" },
      { component: "NavGroup", file: "src/components/layout/app-sidebar.tsx" },
      { component: "AppSidebar", file: "src/components/layout/authenticated-layout.tsx" },
    ]);
  });

  // A shadcn dropdown trigger (React 19 on Radix): Radix's wrappers are owners too. Their stacks
  // are in node_modules, in whatever form the dev server serves it (pnpm store, a Turbopack chunk
  // named after the flattened path); they are skipped before the cap.
  it("React 19: skips Radix wrapper owners whose stack is only library code, before the cap", () => {
    const doc = page("<button>Account</button>");
    const owner = (name: string, url: string, parent: object | null) => ({
      type: { displayName: name },
      _debugOwner: parent,
      _debugStack: debugStack(url),
    });
    const sidebar = owner("AppSidebar", "http://localhost:5173/src/components/layout/authenticated-layout.tsx:20:7", null);
    const navUser = owner("NavUser", "http://localhost:5173/src/components/layout/app-sidebar.tsx:31:9", sidebar);
    const trigger = owner("DropdownMenuTrigger", "http://localhost:5173/src/components/layout/nav-user.tsx:40:11", navUser);
    const radixTrigger = owner("DropdownMenuTrigger", "http://localhost:5173/src/components/ui/dropdown-menu.tsx:12:3", trigger);
    const slot = owner(
      "Slot",
      "http://localhost:3000/_next/static/chunks/node_modules_@radix-ui_react-slot_dist_index_mjs_1a2b._.js:61:20",
      radixTrigger,
    );
    const primitive = owner(
      "Primitive.button",
      "http://localhost:5173/node_modules/.pnpm/@radix-ui+react-primitive@2.1.3/node_modules/@radix-ui/react-primitive/dist/index.mjs:38:9",
      slot,
    );
    setProp(el(doc, "button"), "__reactFiber$x", { type: "button", _debugOwner: primitive });
    expect(readRenderedBy(el(doc, "button"))).toEqual([
      { component: "DropdownMenuTrigger", file: "src/components/ui/dropdown-menu.tsx" },
      { component: "DropdownMenuTrigger", file: "src/components/layout/nav-user.tsx" },
      { component: "NavUser", file: "src/components/layout/app-sidebar.tsx" },
    ]);
  });

  it("goes through the bridge into ElementInfo.renderedBy, next to component", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", {
      loc: { file: "src/lib/Card.svelte", line: 3, column: 2 },
      parent: linked([{ type: "component", file: "src/routes/+page.svelte", line: 7, column: 0, componentTag: "Card" }]),
    });
    const info = describeElement(el(doc, "p"));
    expect(info.component).toMatchObject({ framework: "svelte", file: "src/lib/Card.svelte" });
    expect(info.renderedBy).toEqual([{ component: "Card", file: "src/routes/+page.svelte", line: 7, column: 1 }]);
    expect(el(doc, "p").hasAttribute(COMPONENT_ATTRIBUTE)).toBe(false);
  });

  it("is absent without dev data, and never throws on odd internals", () => {
    const doc = page('<div id="a"><p>hi</p></div><div id="b"><p>ho</p></div>');
    expect(readRenderedBy(el(doc, "#a p"))).toBeUndefined();
    // A getter that throws in the middle of the chain.
    const throwing = { type: "component", file: "src/A.svelte", line: 1, column: 0 };
    Object.defineProperty(throwing, "parent", {
      get() {
        throw new Error("boom");
      },
    });
    setProp(el(doc, "#a p"), "__svelte_meta", { loc: { file: "src/A.svelte", line: 1, column: 0 }, parent: throwing });
    expect(readRenderedBy(el(doc, "#a p"))).toBeUndefined();
    // A cycle in Vue's parent links is walked a bounded number of times.
    const cyclic: Record<string, unknown> = { type: { name: "Loop" } };
    cyclic.parent = cyclic;
    cyclic.vnode = { ctx: cyclic };
    setProp(el(doc, "#b p"), "__vueParentComponent", cyclic);
    expect(readRenderedBy(el(doc, "#b p"))).toBeUndefined();
  });
});

describe("the bridge", () => {
  it("answers nothing when no framework data is there, and leaves no attribute behind", () => {
    const doc = page("<button>Plain</button>");
    const button = el(doc, "button");
    expect(requestComponent(button)).toBeUndefined();
    expect(button.hasAttribute(COMPONENT_ATTRIBUTE)).toBe(false);
  });

  it("is silent without the MAIN-world script (production site): no component, no error", () => {
    const doc = page("<button>Plain</button>", false);
    setProp(el(doc, "button"), "__svelte_meta", { loc: { file: "src/A.svelte", line: 1, column: 0 } });
    expect(requestComponent(el(doc, "button"))).toBeUndefined();
  });

  it("removes the result attribute, so the page and the captured html never see it", () => {
    const doc = page("<p>hi</p>");
    setProp(el(doc, "p"), "__svelte_meta", { loc: { file: "src/A.svelte", line: 1, column: 0 } });
    const info = describeElement(el(doc, "p"));
    expect(info.component).toMatchObject({ framework: "svelte", file: "src/A.svelte" });
    expect(info.html).toBe("<p>hi</p>");
    expect(el(doc, "p").hasAttribute(COMPONENT_ATTRIBUTE)).toBe(false);
  });

  it("does not bubble to app listeners", () => {
    const doc = page('<div id="app"><p>hi</p></div>');
    let seen = 0;
    el(doc, "#app").addEventListener("pointcast:component-request", () => seen++);
    requestComponent(el(doc, "p"));
    expect(seen).toBe(0);
  });

  it("answers for an element inside an open shadow root", () => {
    const doc = page("<x-card></x-card>");
    const root = el(doc, "x-card").attachShadow({ mode: "open" });
    root.innerHTML = "<button>Buy</button>";
    const button = root.querySelector("button") as Element;
    setProp(button, "__vueParentComponent", { type: { name: "BuyButton" }, parent: null });
    expect(requestComponent(button)).toEqual({ framework: "vue", name: "BuyButton" });
  });

  it("survives framework internals that throw", () => {
    const doc = page("<p>hi</p>");
    Object.defineProperty(el(doc, "p"), "__vueParentComponent", {
      get() {
        throw new Error("boom");
      },
    });
    expect(requestComponent(el(doc, "p"))).toBeUndefined();
  });
});

describe("parseComponentInfo (the attribute is untrusted page input)", () => {
  it("keeps only known fields with the right types, bounded", () => {
    const json = JSON.stringify({
      framework: "Vue",
      name: "A".repeat(500),
      file: "src/A.vue",
      line: 3,
      column: 2.5,
      props: { password: "hunter2" },
    });
    const info = parseFrameworkInfo(`{"component":${json}}`).component;
    expect(info).toEqual({ framework: "vue", name: "A".repeat(80), file: "src/A.vue", line: 3 });
  });

  it("rejects garbage and answers without a name or file", () => {
    expect(parseFrameworkInfo("not json")).toEqual({});
    expect(parseFrameworkInfo("[1,2]")).toEqual({});
    expect(parseFrameworkInfo('{"component":"x","renderedBy":{"file":"src/A.vue"}}')).toEqual({});
    expect(parseComponentInfo({ framework: "react" })).toBeUndefined();
    expect(parseComponentInfo({ name: "X" })).toBeUndefined();
  });

  it("keeps at most 3 renderedBy frames, each with a file, bounded and project-relative", () => {
    const frames = parseRenderedBy([
      { component: "B".repeat(500), file: "C:/Users/hugob/app/src/pages/Orders.tsx", line: 20, column: 7, props: { a: 1 } },
      { component: "NoFile", line: 3 },
      { file: "src/routes.tsx", line: 0, column: 4 },
      "garbage",
      { file: "/home/hugo/app/src/main.tsx", line: 2.5 },
      { component: "Fourth", file: "src/Fourth.tsx" },
    ]);
    // Frames without a file do not count toward the cap.
    expect(frames).toEqual([
      { component: "B".repeat(80), file: "src/pages/Orders.tsx", line: 20, column: 7 },
      { file: "src/routes.tsx" },
      { file: "src/main.tsx" },
    ]);
    expect(parseRenderedBy({ file: "src/A.vue" })).toBeUndefined();
    expect(parseRenderedBy([{ component: "X" }])).toBeUndefined();
  });

  // Radix-style wrappers must not take the 3 places: they are skipped before the cap, whatever
  // form their node_modules path has (pnpm store, absolute, Vite deps, a flattened chunk name).
  it("skips library frames before the 3-frame cap, so the app's own frames are kept", () => {
    const radix = "node_modules/.pnpm/@radix-ui+react-primitive@2.1.3_react@19.1.0/node_modules/@radix-ui/react-primitive/dist/index.mjs";
    const frames = parseRenderedBy([
      { component: "Primitive.button", file: radix, line: 38 },
      { component: "SlotClone", file: "C:/Users/hugob/app/node_modules/@radix-ui/react-slot/dist/index.mjs", line: 61 },
      { component: "Slot", file: "node_modules/.vite/deps/@radix-ui_react-slot.js?v=9f1c" },
      { component: "Presence", file: "_next/static/chunks/node_modules_@radix-ui_react-presence_dist_index_mjs_abc._.js" },
      { component: "DropdownMenuTrigger", file: "src/components/ui/dropdown-menu.tsx", line: 12 },
      { component: "NavUser", file: "src/components/layout/nav-user.tsx", line: 40 },
      { component: "AppSidebar", file: "src/components/layout/app-sidebar.tsx", line: 31 },
      { component: "Portal", file: "node_modules\\@radix-ui\\react-portal\\dist\\index.mjs" },
    ]);
    expect(frames).toEqual([
      { component: "DropdownMenuTrigger", file: "src/components/ui/dropdown-menu.tsx", line: 12 },
      { component: "NavUser", file: "src/components/layout/nav-user.tsx", line: 40 },
      { component: "AppSidebar", file: "src/components/layout/app-sidebar.tsx", line: 31 },
    ]);
    // Only library frames: no chain at all, never a library path.
    expect(parseRenderedBy([{ component: "Slot", file: radix }])).toBeUndefined();
  });

  // PRIVACY (D8): the attribute is untrusted page input, written either by our own MAIN-world
  // script (which already normalizes) or, in principle, by a malicious page bypassing it — this
  // parser must not let an absolute path through either way.
  it("normalizes an absolute file path even when it did not go through framework-main.ts", () => {
    const raw = {
      framework: "vue",
      name: "Evil",
      file: "C:/Users/hugob/Desktop/my-app/src/components/Evil.vue",
    };
    expect(parseComponentInfo(raw)).toEqual({
      framework: "vue",
      name: "Evil",
      file: "src/components/Evil.vue",
    });
  });
});
