import { describe, expect, it } from "vitest";
import type { CapturedEvent, CodeFrame, ElementInfo, SessionFile } from "../schema";
import { codeChain } from "./chain";
import { FLOWBITE, SHADCN, memoryReader } from "./eval-fixtures";
import {
  cachingReader,
  MAX_SNIPPET_CHARS,
  projectMatch,
  propertyKey,
  renderingsOf,
  resolveElement,
  resolveElementDetails,
  resolveSession,
  sourceSnippet,
} from "./resolve";

/** Elements as the extension recorded them in the evaluation (dev/eval/.runs/sessions), plus a chain. */
function el(tag: string, text: string, renderedBy: CodeFrame[] | undefined, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag,
    text,
    selector: `${tag}:nth-of-type(1)`,
    selectorUnique: true,
    path: `main › ${tag}`,
    html: `<${tag}>${text}</${tag}>`,
    ...(renderedBy ? { renderedBy } : {}),
    ...extra,
  };
}

const DASHBOARD = "src/routes/utils/dashboard/Dashboard.svelte";
const SALES_THIS_WEEK_LINE = '<ChartWidget value={12.5} {chartOptions} title="$45,385" subtitle="Sales this week" />';
const PAGE = "src/routes/(sidebar)/+page.svelte";
const FLOWBITE_LIB = "node_modules/.pnpm/flowbite-svelte@1.28.1_rollup@4.53.2_svelte@5.43.10_tailwindcss@4.1.17/node_modules/flowbite-svelte/dist";

/** «Sales Report» in the "$45,385 · Sales this week" card: the shared More, instance in ChartWidget. */
const SALES_REPORT = el(
  "a",
  "Sales Report",
  [
    { file: "src/lib/More.svelte", line: 18 },
    { component: "More", file: "src/lib/ChartWidget.svelte", line: 27 },
    { component: "ChartWidget", file: DASHBOARD, line: 112 },
  ],
  { html: '<a href="#top">Sales Report <svg/></a>', context: "$45,385 · Sales this week" },
);

/** The same shared More link in the other card, "Sales by category · Desktop PC". */
const SALES_REPORT_2 = el(
  "a",
  "Sales Report",
  [
    { file: "src/lib/More.svelte", line: 18 },
    { component: "More", file: "src/lib/CategorySalesReport.svelte", line: 41 },
    { component: "CategorySalesReport", file: DASHBOARD, line: 158 },
  ],
  { html: '<a href="#top">Sales Report <svg/></a>', context: "Sales by category · Desktop PC" },
);

/** The subtitle: rendered by flowbite-svelte's P inside ChartWidget, written where ChartWidget is used. */
const SALES_THIS_WEEK = el("p", "Sales this week", [
  { component: "P", file: "src/lib/ChartWidget.svelte", line: 19 },
  { component: "ChartWidget", file: DASHBOARD, line: 112 },
  { component: "Dashboard", file: PAGE, line: 14 },
]);

/** The second of two identical «Users» cards. */
const USERS = el("h5", "Users", [
  { component: "Heading", file: "src/lib/ProductMetricCard.svelte", line: 11 },
  { component: "ProductMetricCard", file: DASHBOARD, line: 133 },
  { component: "Dashboard", file: PAGE, line: 14 },
]);

/**
 * The Chats badge, as React's owner chain gives it: before collapsing, three frames sit in the
 * shared nav-group.tsx (Badge, NavBadge, SidebarMenuLink).
 */
const CHATS_BADGE = el(
  "span",
  "3",
  [
    { file: "src/components/ui/badge.tsx", line: 37 },
    { component: "Badge", file: "src/components/layout/nav-group.tsx", line: 62 },
    { component: "NavBadge", file: "src/components/layout/nav-group.tsx", line: 77 },
    { component: "SidebarMenuLink", file: "src/components/layout/nav-group.tsx", line: 47 },
    { component: "NavGroup", file: "src/components/layout/app-sidebar.tsx", line: 28 },
  ],
  { selector: 'a[href="/chats"] > span:nth-of-type(2)', html: "<span>3</span>", component: { framework: "react", name: "Badge" } },
);

function session(elements: ElementInfo[]): SessionFile {
  return {
    schemaVersion: 2,
    id: "2026-09-27_06-00-00",
    startedAt: "2026-09-27T04:00:00.000Z",
    t0: 1790000000000,
    durationMs: 30000,
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events: elements.map((element, i): CapturedEvent => ({
      id: `e${i + 1}`,
      gesture: "point",
      tStart: i * 1000,
      tEnd: i * 1000,
      url: "http://127.0.0.1:5544/",
      element,
    })),
  };
}

describe("resolveElement (Stage 0 rules on the eval apps)", () => {
  it("finds the Sales Report link where its instance passes the text, not in the shared More", async () => {
    expect(await resolveElement(SALES_REPORT, memoryReader(FLOWBITE), "repo")).toEqual([
      { kind: "text", file: "src/lib/ChartWidget.svelte", line: 27, via: "repo", snippet: '<More title="Sales Report" href="#top" />' },
    ]);
  });

  it("finds the Sales this week subtitle in Dashboard.svelte:112, not in ChartWidget", async () => {
    expect(await resolveElement(SALES_THIS_WEEK, memoryReader(FLOWBITE), "dev-server")).toEqual([
      { kind: "text", file: DASHBOARD, line: 112, via: "dev-server", snippet: SALES_THIS_WEEK_LINE },
    ]);
  });

  it("tells apart two instances of a shared component by their chains", async () => {
    const reader = memoryReader(FLOWBITE);
    const [first] = await resolveElement(SALES_REPORT, reader, "repo");
    const [second] = await resolveElement(SALES_REPORT_2, reader, "repo");
    expect(first.file).toBe("src/lib/ChartWidget.svelte");
    expect(second).toEqual({
      kind: "text",
      file: "src/lib/CategorySalesReport.svelte",
      line: 41,
      via: "repo",
      snippet: '<More title="Sales Report" href="#top" />',
    });
  });

  it("says nothing when the literal is written twice (the duplicate Users card)", async () => {
    expect(await resolveElement(USERS, memoryReader(FLOWBITE), "repo")).toEqual([]);
  });

  it("does not mistake a dev server's aliased extension for a second file", async () => {
    // React-shaped chain (no lines: framework-main.ts keeps no line for React/Vue frames), a
    // shared StatCard whose distinguishing prop (reportHref) only the parent's JSX literally has.
    const reportLink = el(
      "a",
      "View report",
      [{ component: "StatCard", file: "src/pages/Dashboard.tsx" }, { component: "Dashboard", file: "src/App.tsx" }],
      { html: '<a class="stat-link" href="/reports/revenue">View report</a>' },
    );
    // What a Vite dev server actually does (reproduced from dev/examples/react-dashboard, 2026-09-27):
    // App.tsx imports "./pages/Dashboard" with no extension; the resolver's own ".js" guess is
    // served by Vite as an alias of Dashboard.tsx (only the .tsx file exists on disk), byte for
    // byte, because Vite falls back through its own extension list when the exact path 404s.
    const DASHBOARD_SOURCE = '<StatCard title="Revenue" reportHref="/reports/revenue" />';
    const reader = memoryReader({
      "src/pages/Dashboard.tsx": DASHBOARD_SOURCE,
      "src/App.tsx": 'import { Dashboard } from "./pages/Dashboard";',
      "src/pages/Dashboard.js": DASHBOARD_SOURCE, // the alias; no "src/pages/Dashboard.ts" exists
    });
    expect(await resolveElement(reportLink, reader, "dev-server")).toEqual([
      { kind: "text", file: "src/pages/Dashboard.tsx", line: 1, via: "dev-server", snippet: DASHBOARD_SOURCE },
    ]);
  });

  it("follows one import into the sidebar data for the Chats badge, via the link's href", async () => {
    const reader = memoryReader(SHADCN);
    expect(await resolveElement(CHATS_BADGE, reader, "github")).toEqual([
      // The data line alone ("badge: '3',") says little: the lines around it come with it.
      { kind: "data", file: "src/components/layout/data/sidebar-data.ts", line: 73, via: "github", snippet: "url: '/chats', badge: '3', icon: MessagesSquare," },
    ]);
    // Only the chain files and what they import one hop away were read: never a project search.
    // The one other file is tsconfig.json, for the `@/` import whose `src/` file is not in the
    // fixture (configuredAliasCandidates), which the fixture does not have either.
    expect(reader.reads).toContain("src/components/layout/data/sidebar-data.ts");
    const others = reader.reads.filter((path) => !path.startsWith("src/components/") && !path.startsWith("src/lib/"));
    expect(new Set(others)).toEqual(new Set(["tsconfig.json", "jsconfig.json"]));
  });

  it("reaches the data only because same-file frames collapse before the 3-frame cap", async () => {
    expect(codeChain(CHATS_BADGE).map((frame) => `${frame.file}:${frame.line}`)).toEqual([
      "src/components/ui/badge.tsx:37",
      "src/components/layout/nav-group.tsx:62",
      "src/components/layout/app-sidebar.tsx:28",
    ]);
    // A chain cut to 3 frames before collapsing never leaves nav-group.tsx, so nothing imports the data.
    const cutEarly = { ...CHATS_BADGE, renderedBy: CHATS_BADGE.renderedBy!.slice(0, 3) };
    expect(await resolveElement(cutEarly, memoryReader(SHADCN), "repo")).toEqual([]);
  });

  it("uses the selected text of a selection, the label, and reads nothing without a chain", async () => {
    const paragraph = el("p", "Sales this week and more", SALES_THIS_WEEK.renderedBy);
    expect(await resolveElement(paragraph, memoryReader(FLOWBITE), "repo", "Sales this week")).toEqual([
      { kind: "text", file: DASHBOARD, line: 112, via: "repo", snippet: SALES_THIS_WEEK_LINE },
    ]);
    const tab = el("button", "", [{ component: "Stats", file: DASHBOARD, line: 113 }], { label: "Top products" });
    expect(await resolveElement(tab, memoryReader(FLOWBITE), "repo")).toEqual([
      { kind: "text", file: DASHBOARD, line: 78, via: "repo", snippet: "tab1Title: 'Top products'," },
    ]);
    const reader = memoryReader(FLOWBITE);
    expect(await resolveElement(el("a", "Sales Report", undefined), reader, "repo")).toEqual([]);
    expect(reader.reads).toEqual([]);
  });

  it("never asks the reader for a path outside the project", async () => {
    const reader = memoryReader({});
    const outside = el("a", "x", [
      { file: "../../.ssh/id_rsa" },
      { component: "A", file: "src/../../secret.ts" },
      { component: "B", file: "https://example.com/src/App.tsx" },
    ]);
    expect(await resolveElement(outside, reader, "repo")).toEqual([]);
    expect(reader.reads).toEqual([]);
  });
});

const lines = (...source: string[]): string => source.join("\n");

/**
 * The shape of dev/examples/react-dashboard, with the sidebar importing its own data (the common
 * pattern): <Sidebar /> is used in App.tsx, and Sidebar.tsx renders the Messages badge from
 * data/nav.ts. React 19 frames name where each instance is used, so Sidebar.tsx is no chain file.
 */
const REACT_APP: Record<string, string> = {
  "src/main.tsx": lines(
    'import { createRoot } from "react-dom/client";',
    'import { App } from "./App";',
    "",
    'createRoot(document.getElementById("root")!).render(<App />);',
  ),
  "src/App.tsx": lines(
    'import { Sidebar } from "./components/Sidebar";',
    'import { Dashboard } from "./pages/Dashboard";',
    "",
    "export function App() {",
    '  return <div className="app-shell"><Sidebar /><Dashboard /></div>;',
    "}",
  ),
  "src/components/Sidebar.tsx": lines(
    'import { NAV_ITEMS } from "../data/nav";',
    "",
    "export function Sidebar() {",
    "  return (",
    '    <nav className="sidebar">',
    "      {NAV_ITEMS.map((item) => (",
    "        <a key={item.id} href={item.href}>",
    "          <span>{item.label}</span>",
    '          {item.badge !== undefined && <span className="badge">{item.badge}</span>}',
    "        </a>",
    "      ))}",
    "    </nav>",
    "  );",
    "}",
  ),
  "src/data/nav.ts": lines(
    "export const NAV_ITEMS = [",
    '  { id: "dashboard", label: "Dashboard", href: "/" },',
    '  { id: "orders", label: "Orders", href: "/orders" },',
    '  { id: "messages", label: "Messages", href: "/messages", badge: 3 },',
    "];",
  ),
  "src/pages/Dashboard.tsx": lines(
    'import { OrdersTable } from "../components/OrdersTable";',
    'import { StatCard } from "../components/StatCard";',
    "",
    "export function Dashboard() {",
    "  return (",
    '    <div className="page">',
    '      <StatCard title="Revenue" reportHref="/reports/revenue" />',
    '      <StatCard title="Orders" reportHref="/reports/orders" />',
    "      {/* the \"Export\" button is OrdersTable's */}",
    "      <OrdersTable />",
    "    </div>",
    "  );",
    "}",
  ),
  "src/components/StatCard.tsx": lines(
    "export function StatCard({ title, reportHref }: { title: string; reportHref: string }) {",
    "  return (",
    '    <section className="stat-card">',
    "      <h3>{title}</h3>",
    '      <a className="stat-link" href={reportHref}>',
    "        View report",
    "      </a>",
    "    </section>",
    "  );",
    "}",
  ),
  "src/components/OrdersTable.tsx": lines(
    "/**",
    ' * Orders table with its own "Export" button.',
    " */",
    "export function OrdersTable() {",
    '  const onExport = () => download(); // "Export" handler',
    "  return (",
    "    <section>",
    '      <button type="button" id="orders-export" onClick={onExport}>',
    "        Export",
    "      </button>",
    "    </section>",
    "  );",
    "}",
  ),
};

/** The same sidebar in Vue (dev/examples/vue-dashboard): the element's own component file comes from `__file`. */
const VUE_APP: Record<string, string> = {
  "src/App.vue": lines(
    '<script setup lang="ts">',
    'import Sidebar from "./components/Sidebar.vue";',
    "</script>",
    "",
    "<template>",
    '  <div class="app-shell"><Sidebar /></div>',
    "</template>",
  ),
  "src/components/Sidebar.vue": lines(
    '<script setup lang="ts">',
    'import { NAV_ITEMS } from "../data/nav";',
    "</script>",
    "",
    "<template>",
    "  <!--",
    '    "Messages" and its badge come from data/nav.ts: change them there.',
    "  -->",
    '  <nav class="sidebar">',
    '    <a v-for="item in NAV_ITEMS" :key="item.id" :href="item.href">',
    "      <span>{{ item.label }}</span>",
    '      <span v-if="item.badge !== undefined" class="badge">{{ item.badge }}</span>',
    "    </a>",
    "  </nav>",
    "</template>",
  ),
  "src/data/nav.ts": REACT_APP["src/data/nav.ts"],
};

const MESSAGES_DATA = {
  kind: "data",
  file: "src/data/nav.ts",
  line: 4,
  via: "dev-server",
  snippet: '{ id: "messages", label: "Messages", href: "/messages", badge: 3 },',
};

/** React 19: files only, and no file for the element's own component. */
const REACT_BADGE = el(
  "span",
  "3",
  [
    { component: "Sidebar", file: "src/App.tsx" },
    { component: "App", file: "src/main.tsx" },
  ],
  { selector: 'a[href="/messages"] > span.badge', html: '<span class="badge">3</span>', component: { framework: "react", name: "Sidebar" } },
);

describe("resolveElement: the files that define the chain's components (rule 4)", () => {
  it("finds a React 19 badge's data through the component that imports it (Sidebar.tsx, not a chain file)", async () => {
    const reader = memoryReader(REACT_APP);
    expect(await resolveElement(REACT_BADGE, reader, "dev-server")).toEqual([MESSAGES_DATA]);
    // Sidebar.tsx was found from App.tsx's import of <Sidebar>; still no search of the project.
    expect(reader.reads).toContain("src/components/Sidebar.tsx");
    expect(reader.reads.every((path) => path.startsWith("src/"))).toBe(true);
  });

  it("finds the definition through an alias and an index file that re-exports it", async () => {
    const files = {
      ...REACT_APP,
      "src/App.tsx": REACT_APP["src/App.tsx"].replace('"./components/Sidebar"', '"@/components"'),
      "src/components/index.ts": lines('export { OrdersTable } from "./OrdersTable";', 'export { Sidebar } from "./Sidebar";'),
    };
    expect(await resolveElement(REACT_BADGE, memoryReader(files), "dev-server")).toEqual([MESSAGES_DATA]);
  });

  it("finds a Vue badge's data through the element's own component file, past a comment quoting its text", async () => {
    const messages = el("a", "Messages 3", [{ component: "Sidebar", file: "src/App.vue" }], {
      html: '<a href="/messages" class="nav-item"><span>Messages</span><span class="badge">3</span></a>',
      component: { framework: "vue", name: "Sidebar", file: "src/components/Sidebar.vue" },
    });
    // Read as code, the comment's "Messages" would be the only hit, at Sidebar.vue:7.
    expect(await resolveElement(messages, memoryReader(VUE_APP), "dev-server")).toEqual([MESSAGES_DATA]);
  });

  it("ignores comments: one in a chain file does not steal the match, one in the definition does not duplicate it", async () => {
    const exportButton = el(
      "button",
      "Export",
      [
        { component: "OrdersTable", file: "src/pages/Dashboard.tsx" },
        { component: "Dashboard", file: "src/App.tsx" },
        { component: "App", file: "src/main.tsx" },
      ],
      { html: '<button type="button" id="orders-export">Export</button>', component: { framework: "react", name: "OrdersTable" } },
    );
    // As code, the JSX comment in Dashboard.tsx:9 would be the chain's only "Export", and the JSDoc
    // and the line comment in OrdersTable.tsx would make its button look written three times.
    expect(await resolveElement(exportButton, memoryReader(REACT_APP), "repo")).toEqual([
      {
        kind: "text",
        file: "src/components/OrdersTable.tsx",
        line: 9,
        via: "repo",
        snippet: '<button type="button" id="orders-export" onClick={onExport}> Export </button>',
      },
    ]);
  });

  it("keeps what the chain's files already give: definitions are read only when they gave nothing", async () => {
    const viewReport = el(
      "a",
      "View report",
      [
        { component: "StatCard", file: "src/pages/Dashboard.tsx" },
        { component: "Dashboard", file: "src/App.tsx" },
        { component: "App", file: "src/main.tsx" },
      ],
      { html: '<a class="stat-link" href="/reports/revenue">View report</a>', component: { framework: "react", name: "StatCard" } },
    );
    const reader = memoryReader(REACT_APP);
    // The instance's href (Stage 0's rule 3), not the shared StatCard.tsx that writes the text once.
    expect(await resolveElement(viewReport, reader, "repo")).toEqual([
      { kind: "text", file: "src/pages/Dashboard.tsx", line: 7, via: "repo", snippet: '<StatCard title="Revenue" reportHref="/reports/revenue" />' },
    ]);
    expect(reader.reads).not.toContain("src/components/StatCard.tsx");
  });

  it("says nothing when two definition files write the literal", async () => {
    // Vue slot content: <ReportLink> is written in Dashboard.vue inside <Panel>, whose template puts
    // it in a <Card>. Neither ReportLink.vue (the element's own component) nor Card.vue is a chain file.
    const files = {
      "src/pages/Dashboard.vue": lines(
        "<script setup>",
        'import Panel from "../components/Panel.vue";',
        'import ReportLink from "../components/ReportLink.vue";',
        "</script>",
        "<template><Panel><ReportLink /></Panel></template>",
      ),
      "src/components/Panel.vue": lines("<script setup>", 'import Card from "./Card.vue";', "</script>", "<template><Card><slot /></Card></template>"),
      "src/components/Card.vue": lines("<template>", '  <section><slot /><a class="more">View report</a></section>', "</template>"),
      "src/components/ReportLink.vue": lines("<template>", '  <a class="stat-link">View report</a>', "</template>"),
    };
    const link = el(
      "a",
      "View report",
      [
        { component: "ReportLink", file: "src/pages/Dashboard.vue" },
        { component: "Card", file: "src/components/Panel.vue" },
        { component: "Panel", file: "src/pages/Dashboard.vue" },
      ],
      { component: { framework: "vue", name: "ReportLink", file: "src/components/ReportLink.vue" } },
    );
    expect(await resolveElement(link, memoryReader(files), "repo")).toEqual([]);
    // Written in only one of them, it is found there.
    const once = { ...files, "src/components/Card.vue": lines("<template>", "  <section><slot /></section>", "</template>") };
    expect(await resolveElement(link, memoryReader(once), "repo")).toEqual([
      { kind: "text", file: "src/components/ReportLink.vue", line: 2, via: "repo", snippet: '<a class="stat-link">View report</a>' },
    ]);
  });
});

/** The Messages badge exactly as the extension captured it on dev/examples/react-dashboard: no href anywhere. */
const REACT_BADGE_CAPTURED = el(
  "span",
  "3",
  [
    { component: "Sidebar", file: "src/App.tsx" },
    { component: "App", file: "src/main.tsx" },
  ],
  {
    context: "Main",
    itemLabel: "Messages",
    selector: "span.badge",
    path: "div#root › nav«Main» › ul › li[4] › span[2]",
    html: '<span class="badge">3</span>',
    component: { framework: "react", name: "Sidebar" },
  },
);

describe("resolveElement: a short value through the item it belongs to (rule 3b)", () => {
  it("finds the badge by its item's label, in the data the Sidebar imports (rule 4's pass)", async () => {
    expect(await resolveElement(REACT_BADGE_CAPTURED, memoryReader(REACT_APP), "dev-server")).toEqual([MESSAGES_DATA]);
    // Recorded before itemLabel existed: a lone "3" with no href is nothing to go on.
    const { itemLabel: _, ...recordedBefore } = REACT_BADGE_CAPTURED;
    expect(await resolveElement(recordedBefore, memoryReader(REACT_APP), "dev-server")).toEqual([]);
    // Vue: the same through the element's own component file (`__file`).
    const vue = { ...REACT_BADGE_CAPTURED, renderedBy: [{ component: "Sidebar", file: "src/App.vue" }], component: { framework: "vue", name: "Sidebar", file: "src/components/Sidebar.vue" } };
    expect(await resolveElement(vue, memoryReader(VUE_APP), "dev-server")).toEqual([MESSAGES_DATA]);
  });

  it("points at the value's line in a component file, and never searches the lone value itself", async () => {
    const files = {
      "src/App.tsx": lines(
        "export function App() {",
        "  const layout = { columns: 3, gap: 8 };",
        "  return (",
        '    <ul className="nav">',
        "      <li>",
        '        <a href="#inbox">Inbox</a>',
        '        <span className="badge">3</span>',
        "      </li>",
        "    </ul>",
        "  );",
        "}",
      ),
    };
    const badge = el("span", "3", [{ component: "App", file: "src/App.tsx" }], { itemLabel: "Inbox", html: '<span class="badge">3</span>' });
    expect(await resolveElement(badge, memoryReader(files), "repo")).toEqual([
      { kind: "text", file: "src/App.tsx", line: 7, via: "repo", snippet: '<span className="badge">3</span>' },
    ]);
    // Rule 1 on the lone "3" (a session without itemLabel) finds it twice, columns: 3 included: silence.
    const { itemLabel: _, ...alone } = badge;
    expect(await resolveElement(alone, memoryReader(files), "repo")).toEqual([]);
  });

  it("says nothing when the value is not next to its label, or is written twice there", async () => {
    // The count is computed elsewhere: "Messages" is found once, but no "3" in its entry.
    const computed = {
      ...REACT_APP,
      "src/data/nav.ts": lines(
        "export const NAV_ITEMS = [",
        '  { id: "orders", label: "Orders", href: "/orders" },',
        '  { id: "messages", label: "Messages", href: "/messages" },',
        "];",
        "",
        "",
        "",
        "export const UNREAD = { messages: 3 };",
      ),
    };
    expect(await resolveElement(REACT_BADGE_CAPTURED, memoryReader(computed), "repo")).toEqual([]);
    // Two entries of the window hold a 3: which one is Messages' is a guess.
    const twice = {
      ...REACT_APP,
      "src/data/nav.ts": REACT_APP["src/data/nav.ts"].replace('href: "/orders" }', 'href: "/orders", badge: 3 }'),
    };
    expect(await resolveElement(REACT_BADGE_CAPTURED, memoryReader(twice), "repo")).toEqual([]);
  });

  it("keeps Stage 0's «2+»: a short value without an item label still goes through rule 1", async () => {
    // vuestic-admin's notification badge (dev/eval/.apps, lines 1-6 verbatim): the badge is alone in its
    // button, so no item label, and rule 1 finds it written once, as in Stage 0.
    const dropdown = "src/components/navbar/components/dropdowns/NotificationDropdown.vue";
    const files = {
      [dropdown]: lines(
        "<template>",
        '  <VaDropdown :offset="[13, 0]" class="notification-dropdown" stick-to-edges :close-on-content-click="false">',
        "    <template #anchor>",
        '      <VaButton preset="secondary" color="textPrimary">',
        "        <VaBadge overlap>",
        "          <template #text> 2+</template>",
      ),
    };
    const badge = el(
      "span",
      "2+",
      [
        { component: "VaBadge", file: dropdown },
        { component: "NotificationDropdown", file: "src/components/navbar/components/AppNavbarActions.vue" },
        { component: "AppNavbarActions", file: "src/components/navbar/AppNavbar.vue" },
      ],
      { selector: "span.va-badge__text", html: '<span class="va-badge__text">2+</span>' },
    );
    expect(await resolveElement(badge, memoryReader(files), "repo")).toEqual([
      { kind: "text", file: dropdown, line: 6, via: "repo", snippet: "<template #text> 2+</template>" },
    ]);
  });
});

describe("resolveSession and projectMatch", () => {
  it("fills resolved on a copy of the session and leaves the input untouched", async () => {
    const input = session([SALES_REPORT, USERS, el("h1", "Dashboard", undefined)]);
    const snapshot = JSON.stringify(input);
    const out = await resolveSession(input, memoryReader(FLOWBITE), "repo");
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out.events[0].element.resolved).toEqual([
      { kind: "text", file: "src/lib/ChartWidget.svelte", line: 27, via: "repo", snippet: '<More title="Sales Report" href="#top" />' },
    ]);
    expect(out.events[1].element).not.toHaveProperty("resolved");
    expect(out.events[2]).toBe(input.events[2]);
  });

  it("reports another project when none of the chain files can be read, and keeps what was resolved", async () => {
    const earlier = { ...SALES_REPORT, resolved: [{ kind: "text" as const, file: "src/lib/ChartWidget.svelte", line: 27, via: "dev-server" as const }] };
    const input = session([earlier, SALES_THIS_WEEK]);
    const elsewhere = memoryReader(SHADCN);
    expect(await projectMatch(input, elsewhere)).toEqual({
      matches: false,
      files: ["src/lib/More.svelte", "src/lib/ChartWidget.svelte", DASHBOARD, PAGE],
      readable: [],
    });
    const out = await resolveSession(input, elsewhere, "repo");
    expect(out.events[0].element.resolved).toEqual(earlier.resolved);
    expect(out.events[1].element).not.toHaveProperty("resolved");

    const failing = { read: async () => Promise.reject(new Error("404")) };
    expect((await projectMatch(input, failing)).matches).toBe(false);
    expect((await projectMatch(input, memoryReader(FLOWBITE))).matches).toBe(true);
    expect((await projectMatch(session([el("h1", "Dashboard", undefined)]), elsewhere)).matches).toBeUndefined();
  });

  it("reads each file once through a caching reader", async () => {
    const reader = memoryReader(FLOWBITE);
    const cached = cachingReader(reader);
    const input = session([SALES_REPORT, SALES_THIS_WEEK, USERS]);
    await projectMatch(input, cached);
    await resolveSession(input, cached, "repo");
    expect(reader.reads.length).toBe(new Set(reader.reads).size);
  });
});

describe("snippets: the source lines the resolver already read", () => {
  it("quotes the line, collapsed; a bare word comes with the lines around it; blank or missing gives nothing", () => {
    const lines = ["<script>", "", "  <Button	variant=\"primary\">", "    Export", "  </Button>", "", "  <a href={href}>{title}</a>   "];
    expect(sourceSnippet(lines, 7)).toBe("<a href={href}>{title}</a>");
    expect(sourceSnippet(lines, 4)).toBe('<Button variant="primary"> Export </Button>');
    // A neighbour that is blank is left out, not searched past.
    expect(sourceSnippet(["", "", "{title}", ""], 3)).toBe("{title}");
    expect(sourceSnippet(lines, 2)).toBeUndefined();
    expect(sourceSnippet(lines, 99)).toBeUndefined();
    const long = sourceSnippet(["x".repeat(300)], 1)!;
    expect(long.length).toBe(MAX_SNIPPET_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });

  it("gives each renderedBy frame with a line the source at that line, from the files already read", async () => {
    const reader = memoryReader(FLOWBITE);
    const out = await resolveSession(session([SALES_THIS_WEEK]), cachingReader(reader), "repo");
    expect(out.events[0].element.renderedBy).toEqual([
      {
        component: "P",
        file: "src/lib/ChartWidget.svelte",
        line: 19,
        snippet: '<P class="text-base font-light text-gray-500 dark:text-gray-300">{subtitle}</P>',
      },
      { component: "ChartWidget", file: DASHBOARD, line: 112, snippet: SALES_THIS_WEEK_LINE },
      { component: "Dashboard", file: PAGE, line: 14, snippet: "<Dashboard />" },
    ]);
    // The snippets come from the chain's own files. The only other reads are rule 1's check across
    // the chain's definitions (pass 2): the imports of those files, probed by name, never a search.
    expect(reader.reads.slice(0, 3)).toEqual(["src/lib/ChartWidget.svelte", DASHBOARD, PAGE]);
    expect(reader.reads.slice(3).every((path) => path.startsWith("src/lib"))).toBe(true);
    // The input keeps its frames as recorded.
    expect(SALES_THIS_WEEK.renderedBy![0]).not.toHaveProperty("snippet");
  });

  it("keeps no snippet for a sensitive element (D8): its line could hold the text capture redacted", async () => {
    const field = el("input", "", SALES_THIS_WEEK.renderedBy, { sensitive: true, label: "Top products" });
    const out = await resolveSession(session([field]), memoryReader(FLOWBITE), "repo");
    expect(out.events[0].element.resolved).toEqual([{ kind: "text", file: DASHBOARD, line: 78, via: "repo" }]);
    expect(out.events[0].element.renderedBy).toEqual(SALES_THIS_WEEK.renderedBy);
  });

  it("gives no snippet to a frame without a line (Vue) or whose file was not read", async () => {
    const vue = el("button", "Export", [
      { component: "VaButton", file: "src/pages/admin/dashboard/cards/RevenueReport.vue" },
      { component: "RevenueReport", file: "src/pages/admin/dashboard/Dashboard.vue", line: 16 },
    ]);
    const out = await resolveSession(session([vue]), memoryReader({ "src/pages/admin/dashboard/cards/RevenueReport.vue": "Export" }), "repo");
    expect(out.events[0].element.renderedBy).toEqual(vue.renderedBy);
    expect(out.events[0].element.resolved).toEqual([
      { kind: "text", file: "src/pages/admin/dashboard/cards/RevenueReport.vue", line: 1, via: "repo", snippet: "Export" },
    ]);
  });
});

describe("server templates (pointcast-django's markers, D9 note 2026-09-28)", () => {
  const LIST = "templates/pim/list.html";
  const frames = (...files: string[]): CodeFrame[] => files.map((file) => ({ file, component: file.replace(/^.*?templates\//, "") }));

  it("treats {# #} and {% comment %} as comments in a template, line for line", async () => {
    const source = [
      "{# Exportar CSV #}", // 1
      "{% comment 'old' %}", // 2
      "  <button>Exportar CSV</button>", // 3
      "{% endcomment %}", // 4
      "{#", // 5: Jinja's comments may span lines
      "  Exportar CSV", // 6
      "#}", // 7
      '<button type="button">Exportar CSV</button>', // 8
    ].join("\n");
    const found = await resolveElement(el("button", "Exportar CSV", frames(LIST)), memoryReader({ [LIST]: source }), "repo");
    expect(found).toEqual([{ kind: "text", file: LIST, line: 8, via: "repo", snippet: '<button type="button">Exportar CSV</button>' }]);
  });

  it("bounds a literal by template tags, and keeps quoted literals inside tags", async () => {
    const reader = memoryReader({
      [LIST]: '<span>{% if on %}Activo{% else %}Inactivo{% endif %}</span>\n<p>Pedidos ({{ n }})</p>\n{% translate "Guardar" %}',
    });
    expect((await resolveElement(el("span", "Activo", frames(LIST)), reader, "repo"))[0]?.line).toBe(1);
    expect((await resolveElement(el("p", "Pedidos (12)", frames(LIST)), reader, "repo"))[0]?.line).toBe(2);
    expect((await resolveElement(el("button", "Guardar", frames(LIST)), reader, "repo"))[0]?.line).toBe(3);
  });

  it("leaves Svelte's {#if} and {#each} alone: only template files get template comments", async () => {
    const file = "src/lib/List.svelte";
    const reader = memoryReader({ [file]: "{#each items as item}<li>Archive</li>{/each}" });
    const found = await resolveElement(el("li", "Archive", [{ component: "List", file, line: 1 }]), reader, "repo");
    expect(found).toEqual([{ kind: "text", file, line: 1, via: "repo", snippet: "{#each items as item}<li>Archive</li>{/each}" }]);
  });

  it("follows {% include %} by name only when the chain's templates have nothing (rule 4)", async () => {
    const reader = memoryReader({
      [LIST]: '<h1>Productos</h1>\n<p>{% include "pim/hint.html" %}</p>\n{# {% include "pim/old.html" %} #}',
      "templates/pim/hint.html": "Sin productos",
      "templates/pim/old.html": "Sin productos",
    });
    expect(await resolveElement(el("p", "Sin productos", frames(LIST)), reader, "repo")).toEqual([
      { kind: "text", file: "templates/pim/hint.html", line: 1, via: "repo", snippet: "Sin productos" },
    ]);
    // The chain's own answer wins, and nothing more is read for it.
    const chainOnly = memoryReader({ [LIST]: '<h1>Productos</h1>\n{% include "pim/hint.html" %}' });
    expect(await resolveElement(el("h1", "Productos", frames(LIST)), chainOnly, "repo")).toHaveLength(1);
    expect(chainOnly.reads).toEqual([LIST]);
  });

  it("looks an include up in the app's templates folder (APP_DIRS)", async () => {
    const reader = memoryReader({
      [LIST]: '<p>{% include "pim/partials/hint.html" %}</p>',
      "pim/templates/pim/partials/hint.html": "Sin productos",
    });
    const found = await resolveElement(el("p", "Sin productos", frames(LIST)), reader, "repo");
    expect(found[0]?.file).toBe("pim/templates/pim/partials/hint.html");
  });

  const ROW = "templates/pim/partials/row.html";
  const locate = async (element: ElementInfo, files: Record<string, string>) =>
    (await resolveElement(element, memoryReader(files), "repo")).map(({ file, line }) => `${file}:${line}`);

  it("searches the innermost template first, then the rest of the chain", async () => {
    const files = { [ROW]: "<tr>\n  <td><span>Archivado</span></td>\n</tr>", [LIST]: '<select><option value="a">Archivado</option></select>' };
    expect(await locate(el("span", "Archivado", frames(ROW, LIST)), files)).toEqual([`${ROW}:2`]);
    // Nothing in the innermost template: the rest of the chain, as before.
    expect(await locate(el("h1", "Productos", frames(ROW, LIST)), { [ROW]: "<tr></tr>", [LIST]: "<h1>Productos</h1>" })).toEqual([`${LIST}:1`]);
    // Twice in the innermost template: silence, the outer templates are not consulted.
    expect(await locate(el("span", "Archivado", frames(ROW, LIST)), { ...files, [ROW]: "<span>Archivado</span>\n<span>Archivado</span>\n" })).toEqual([]);
  });

  it("keeps Stage 0's whole-chain search for component chains, tie-broken by the element's tag (pass 2)", async () => {
    const files = { "src/Row.svelte": "<span>Archivado</span>", "src/List.svelte": "<option>Archivado</option>" };
    const element = el("span", "Archivado", [
      { component: "Row", file: "src/Row.svelte", line: 1 },
      { component: "List", file: "src/List.svelte", line: 1 },
    ]);
    // Both files are searched at once (no innermost-first for components); the span's own tag decides.
    expect(await locate(element, files)).toEqual(["src/Row.svelte:1"]);
    // The same tag in both: silence, as in Stage 0.
    expect(await locate(element, { ...files, "src/List.svelte": "<span>Archivado</span>" })).toEqual([]);
  });

  it("breaks a tie by the element's tag when every hit shows its tag (tag filter)", async () => {
    const source = [
      '<label class="form-label">Estado</label>', // 1: the filter
      "<table><thead><tr>", // 2
      '  <th>SKU</th><th class="x">Estado</th>', // 3: the column
      "</tr></thead></table>", // 4
      '<span class="badge">{% if a %}<i class="bi bi-check"></i> Activo{% endif %}</span>', // 5
      "<th>Activo</th>", // 6
    ].join("\n");
    expect(await locate(el("th", "Estado", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:3`]);
    expect(await locate(el("label", "Estado", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:1`]);
    // Past a template tag and an empty <i>.
    expect(await locate(el("span", "Activo", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:5`]);
  });

  it("stays silent when the tag filter cannot tell (same tag twice, a tag on another line)", async () => {
    expect(await locate(el("th", "Fecha", frames(LIST)), { [LIST]: "<th>Fecha</th>\n<th>Fecha</th>" })).toEqual([]);
    const split = '<button type="button"\n        class="btn">\n  Cancelar\n</button>\n<a href="/">Cancelar</a>';
    expect(await locate(el("button", "Cancelar", frames(LIST)), { [LIST]: split })).toEqual([]);
    // Component files have their own tie-break since pass 2 (byEnclosingName): the th's own tag.
    const svelte = { "src/A.svelte": "<th>Estado</th>\n<label>Estado</label>" };
    expect(await locate(el("th", "Estado", [{ component: "A", file: "src/A.svelte", line: 1 }]), svelte)).toEqual(["src/A.svelte:1"]);
  });

  it("does not count scripts, attribute values or {% if %} operands as on-screen text", async () => {
    const source = [
      '<button id="ref">Añadir por referencia</button>', // 1
      "<script>", // 2
      "  aviso('Usa \"Añadir por referencia\".');", // 3
      "</script>", // 4
      '<a class="nav-link {% if tab == \'x\' %}active{% endif %}" title="Enviada">Pedidos</a>', // 5
      "{% if envio.estado == 'Enviada' %}<span>Enviada</span>{% endif %}", // 6
      '<style>.x::after { content: "Pedidos"; }</style>', // 7
    ].join("\n");
    expect(await locate(el("button", "Añadir por referencia", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:1`]);
    expect(await locate(el("span", "Enviada", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:6`]);
    expect(await locate(el("a", "Pedidos", frames(LIST)), { [LIST]: source })).toEqual([`${LIST}:5`]);
  });

  it("still counts {% trans %}, and still finds labels and hrefs in attributes", async () => {
    const source = '<button>{% trans "Guardar" %}</button>\n<button>{% translate "Guardar" %}</button>';
    expect(await locate(el("button", "Guardar", frames(LIST)), { [LIST]: source })).toEqual([]);
    const label = el("input", "", frames(LIST), { label: "Buscar producto" });
    expect(await locate(label, { [LIST]: '<input type="search" placeholder="Buscar producto">' })).toEqual([`${LIST}:1`]);
    // A text only in a data attribute is not the element's text: nothing, rather than that line.
    expect(await locate(el("span", "su pedido", frames(LIST)), { [LIST]: '<div data-origen="su pedido"></div>' })).toEqual([]);
  });

  it("marks template frames in the chain", () => {
    expect(codeChain(el("p", "x", frames(LIST, "templates/base.html")))).toEqual([
      { component: "pim/list.html", host: false, file: LIST, template: true },
      { component: "base.html", host: false, file: "templates/base.html", template: true },
    ]);
  });
});

/**
 * dev/examples/next-dashboard, trimmed: Next.js App Router without src/, `@/*` -> `./*`, Server
 * Components rendering data read on the server. Chains as the extension records them there.
 */
const NEXT: Record<string, string> = {
  "tsconfig.json": `{
  // create-next-app's
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"], },
  },
}`,
  "app/layout.tsx": [
    'import type { Metadata } from "next";',
    'import { Sidebar } from "@/components/sidebar";',
    "",
    "export const metadata: Metadata = {",
    '  title: "Acme Ops",',
    "};",
    "",
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    "  return (",
    "    <html>",
    "      <body>",
    "        <Sidebar />",
    "        <strong>Acme Store EU</strong>",
    "        {children}",
    "      </body>",
    "    </html>",
    "  );",
    "}",
  ].join("\n"),
  "components/sidebar.tsx": [
    'import { NAV_ITEMS } from "@/lib/nav";',
    'import { NavLink } from "./nav-link";',
    "",
    "export function Sidebar() {",
    "  return (",
    "    <aside>",
    '      <div className="brand">Acme Ops</div>',
    "      {NAV_ITEMS.map((item) => (",
    "        <NavLink key={item.href} href={item.href} badge={item.badge}>{item.title}</NavLink>",
    "      ))}",
    "    </aside>",
    "  );",
    "}",
  ].join("\n"),
  "components/nav-link.tsx": ['"use client";', "export function NavLink({ href, badge, children }) {", '  return <a href={href}>{children}<span className="badge">{badge}</span></a>;', "}"].join("\n"),
  "lib/nav.ts": ["export const NAV_ITEMS = [", '  { title: "Overview", href: "/" },', '  { title: "Orders", href: "/orders", badge: "12" },', "];"].join("\n"),
  "app/page.tsx": [
    'import { StatCard } from "@/components/stat-card";',
    'import { getOrders, getStats } from "@/lib/data";',
    "",
    "export default async function OverviewPage() {",
    "  const [stats, orders] = await Promise.all([getStats(), getOrders()]);",
    "  return (",
    "    <>",
    "      <h1>Overview</h1>",
    "      {stats.map((stat) => <StatCard key={stat.label} stat={stat} />)}",
    '      {orders.map((order) => <span key={order.id} className="customer">{order.customer}</span>)}',
    "    </>",
    "  );",
    "}",
  ].join("\n"),
  "components/stat-card.tsx": [
    'import { formatValue, type Stat } from "@/lib/data";',
    "export function StatCard({ stat }: { stat: Stat }) {",
    "  return <div><h3>{stat.label}</h3><p>{formatValue(stat.value)}</p></div>;",
    "}",
  ].join("\n"),
  "lib/data.ts": [
    'const STATS = [{ label: "Revenue", value: 48210 }, { label: "Orders", value: 318 }];',
    "const ORDERS = [",
    '  { id: "A-1", customer: "Olivia Martin" },',
    '  { id: "A-2", customer: "Jackson Lee" },',
    "];",
    "export async function getStats() { return STATS; }",
    "export async function getOrders() { return ORDERS; }",
    "export function formatValue(value: number) { return `$${value}`; }",
  ].join("\n"),
};

function nextElement(tag: string, text: string, own: { name: string; file: string; line: number }, renderedBy: CodeFrame[], extra: Partial<ElementInfo> = {}): ElementInfo {
  return el(tag, text, undefined, { component: { framework: "react", ...own }, renderedBy, ...extra });
}

describe("Next.js App Router (D9 note 2026-09-28)", () => {
  it("makes an empty renderedBy with the element's own file:line a chain of one", () => {
    const h1 = nextElement("h1", "Overview", { name: "OverviewPage", file: "app/page.tsx", line: 8 }, []);
    expect(codeChain(h1)).toEqual([{ host: true, file: "app/page.tsx", line: 8 }]);
    // Without renderedBy (older sessions), nothing changes.
    expect(codeChain({ ...h1, renderedBy: undefined })).toEqual([]);
    expect(codeChain({ ...h1, component: { framework: "react", name: "X", file: "node_modules/next/dist/x.js", line: 3 } })).toEqual([]);
  });

  it("finds the page's own text in the page", async () => {
    const h1 = nextElement("h1", "Overview", { name: "OverviewPage", file: "app/page.tsx", line: 8 }, []);
    expect(await resolveElement(h1, memoryReader(NEXT), "repo")).toEqual([{ kind: "text", file: "app/page.tsx", line: 8, via: "repo", snippet: "<h1>Overview</h1>" }]);
  });

  it("does not count the metadata title as a second «Acme Ops»", async () => {
    const brand = nextElement("div", "Acme Ops", { name: "Sidebar", file: "components/sidebar.tsx", line: 7 }, [
      { component: "Sidebar", file: "app/layout.tsx", line: 12 },
    ]);
    expect(await resolveElement(brand, memoryReader(NEXT), "repo")).toMatchObject([{ kind: "text", file: "components/sidebar.tsx", line: 7 }]);
    // The same text in the layout's markup, in the same tag, would still be written twice: silence.
    const twice = { ...NEXT, "app/layout.tsx": NEXT["app/layout.tsx"].replace("<strong>Acme Store EU</strong>", "<div>Acme Ops</div>") };
    expect(await resolveElement(brand, memoryReader(twice), "repo")).toEqual([]);
    // In another tag (pass 2's tie-break): the div's own line.
    const strong = { ...NEXT, "app/layout.tsx": NEXT["app/layout.tsx"].replace("Acme Store EU", "Acme Ops") };
    expect(await resolveElement(brand, memoryReader(strong), "repo")).toMatchObject([{ file: "components/sidebar.tsx", line: 7 }]);
  });

  it("finds data rendered by a Server Component in the data module it imports (rule 5), through tsconfig's @/", async () => {
    const customer = nextElement("span", "Jackson Lee", { name: "OverviewPage", file: "app/page.tsx", line: 10 }, []);
    expect(await resolveElement(customer, memoryReader(NEXT), "repo")).toEqual([
      { kind: "data", file: "lib/data.ts", line: 4, via: "repo", snippet: NEXT["lib/data.ts"].split("\n")[3].trim() },
    ]);
    const title = nextElement("h3", "Revenue", { name: "StatCard", file: "components/stat-card.tsx", line: 3 }, [
      { component: "StatCard", file: "app/page.tsx", line: 9 },
    ]);
    expect(await resolveElement(title, memoryReader(NEXT), "repo")).toMatchObject([{ kind: "data", file: "lib/data.ts", line: 1 }]);
  });

  it("keeps rule 5 silent when the literal is written twice in the data, or is only a number", async () => {
    // «Orders» is a nav title (lib/nav.ts) and a stat label (lib/data.ts); the layout imports the one, the page the other.
    const twice = { ...NEXT, "lib/data.ts": NEXT["lib/data.ts"].replace('customer: "Olivia Martin"', 'customer: "Jackson Lee"') };
    const customer = nextElement("span", "Jackson Lee", { name: "OverviewPage", file: "app/page.tsx", line: 10 }, []);
    expect(await resolveElement(customer, memoryReader(twice), "repo")).toEqual([]);
    const value = nextElement("span", "12", { name: "NavLink", file: "components/nav-link.tsx", line: 3 }, [{ component: "NavLink", file: "components/sidebar.tsx", line: 9 }], {
      itemLabel: "Orders",
      html: '<span class="badge">12</span>',
    });
    // Rule 3b (not 5) finds the badge, through the item's label, once the alias is followed.
    expect(await resolveElement(value, memoryReader(NEXT), "repo")).toMatchObject([{ kind: "data", file: "lib/nav.ts", line: 3 }]);
  });

  it("follows @/ to the project root only when tsconfig says so", async () => {
    const { ["tsconfig.json"]: _config, ...withoutConfig } = NEXT;
    const customer = nextElement("span", "Jackson Lee", { name: "OverviewPage", file: "app/page.tsx", line: 10 }, []);
    expect(await resolveElement(customer, memoryReader(withoutConfig), "repo")).toEqual([]);
    const src = { ...withoutConfig, "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }' };
    expect(await resolveElement(customer, memoryReader(src), "repo")).toEqual([]);
  });
});

describe("shown by: the line that renders a data literal's key (D9 note 2026-09-28)", () => {
  const TABLE = "src/components/OrdersTable.tsx";
  const DASH = "src/pages/Dashboard.tsx";
  /** dev/examples' OrdersTable shape: ORDERS and the JSX that maps over it in one file, used in Dashboard.tsx. */
  const ordersApp = (...render: string[]): Record<string, string> => ({
    [DASH]: lines('import { OrdersTable } from "../components/OrdersTable";', "", "export function Dashboard() {", "  return <OrdersTable />;", "}"),
    [TABLE]: lines(
      "const ORDERS = [", // 1
      '  { id: "A-1042", customer: "Lina Torres", total: "$128.00" },', // 2
      '  { id: "A-1041", customer: "Marco Peña", total: "$64.50" },', // 3
      "];", // 4
      "", // 5
      "export function OrdersTable() {", // 6
      "  return (", // 7
      "    <table>", // 8
      ...render, // 9…
      "    </table>",
      "  );",
      "}",
    ),
  });
  const MAPPED = [
    "      {ORDERS.map((order) => (", // 9
    "        <tr key={order.id} title={order.customer}>", // 10: attributes, not content
    "          <td>{order.id}</td>", // 11
    "          <td>{order.customer}</td>", // 12
    "          <td>{order.total}</td>", // 13
    "        </tr>", // 14
    "      ))}", // 15
  ];
  const MARCO = el("td", "Marco Peña", [{ component: "OrdersTable", file: DASH }, { component: "Dashboard", file: "src/App.tsx" }], {
    component: { framework: "react", name: "OrdersTable" },
  });
  const MARCO_TEXT = { kind: "text", file: TABLE, line: 3, via: "repo", snippet: '{ id: "A-1041", customer: "Marco Peña", total: "$64.50" },' };

  it("React, data and render in the same file: the cell of the map over ORDERS", async () => {
    const reader = memoryReader(ordersApp(...MAPPED));
    expect(await resolveElementDetails(MARCO, reader, "repo")).toEqual({
      resolved: [MARCO_TEXT],
      shownBy: { key: "customer", file: TABLE, line: 12, via: "repo", snippet: "<td>{order.customer}</td>" },
    });
    // resolveElement is unchanged, and shown by read nothing more.
    const plain = memoryReader(ordersApp(...MAPPED));
    expect(await resolveElement(MARCO, plain, "repo")).toEqual([MARCO_TEXT]);
    expect(reader.reads).toEqual(plain.reads);
    const total = el("td", "$128.00", MARCO.renderedBy, { component: MARCO.component, itemLabel: "A-1042" });
    expect((await resolveElementDetails(total, memoryReader(ordersApp(...MAPPED)), "repo")).shownBy?.line).toBe(13);
  });

  it("React, data in an imported module: the badge's {item.badge}, not its {item.badge !== undefined && …}", async () => {
    expect(await resolveElementDetails(REACT_BADGE_CAPTURED, memoryReader(REACT_APP), "dev-server")).toEqual({
      resolved: [MESSAGES_DATA],
      shownBy: {
        key: "badge",
        file: "src/components/Sidebar.tsx",
        line: 9,
        via: "dev-server",
        snippet: '{item.badge !== undefined && <span className="badge">{item.badge}</span>}',
      },
    });
  });

  it("Vue: {{ item.badge }} in the component's template", async () => {
    const vue = { ...REACT_BADGE_CAPTURED, renderedBy: [{ component: "Sidebar", file: "src/App.vue" }], component: { framework: "vue", name: "Sidebar", file: "src/components/Sidebar.vue" } };
    const found = await resolveElementDetails(vue, memoryReader(VUE_APP), "dev-server");
    expect(found.resolved).toEqual([MESSAGES_DATA]);
    expect(found.shownBy).toMatchObject({ key: "badge", file: "src/components/Sidebar.vue", line: 12 });
  });

  it("Svelte: a link's label from a data module, rendered in the {#each}", async () => {
    const files = {
      "src/App.svelte": lines("<script>", '  import Nav from "./lib/Nav.svelte";', "</script>", "", "<Nav />"),
      "src/lib/Nav.svelte": lines(
        "<script>",
        '  import { LINKS } from "./links";',
        "</script>",
        "",
        "<nav>",
        "  {#each LINKS as link}",
        "    <a href={link.href}>{link.label}</a>",
        "  {/each}",
        "</nav>",
      ),
      "src/lib/links.ts": lines("export const LINKS = [", '  { href: "/reports", label: "Reports" },', '  { href: "/team", label: "Team" },', "];"),
    };
    const link = el("a", "Reports", [{ file: "src/lib/Nav.svelte", line: 7 }, { component: "Nav", file: "src/App.svelte", line: 5 }], {
      html: '<a href="/reports">Reports</a>',
      component: { framework: "svelte", name: "Nav", file: "src/lib/Nav.svelte", line: 7 },
    });
    const found = await resolveElementDetails(link, memoryReader(files), "repo");
    expect(found.resolved.map(({ kind, file, line }) => `${kind} ${file}:${line}`)).toEqual(["data src/lib/links.ts:2"]);
    expect(found.shownBy).toEqual({ key: "label", file: "src/lib/Nav.svelte", line: 7, via: "repo", snippet: "<a href={link.href}>{link.label}</a>" });
  });

  it("optional chaining, and a destructured key", async () => {
    const optional = ordersApp("      {ORDERS.map((order) => <tr><td>{order?.customer}</td></tr>)}");
    expect((await resolveElementDetails(MARCO, memoryReader(optional), "repo")).shownBy?.line).toBe(9);
    const destructured = ordersApp(
      "      {ORDERS.map(({ id, customer }) => (", // 9
      "        <tr key={id}>", // 10
      "          <td>{customer}</td>", // 11
      "        </tr>", // 12
      "      ))}", // 13
    );
    expect((await resolveElementDetails(MARCO, memoryReader(destructured), "repo")).shownBy?.line).toBe(11);
  });

  it("stays silent on two renderings of the key (a table and a card list), keeping the text line", async () => {
    const twice = ordersApp(...MAPPED, "      {ORDERS.map((order) => <li key={order.id}>{order.customer}</li>)}");
    expect(await resolveElementDetails(MARCO, memoryReader(twice), "repo")).toEqual({ resolved: [MARCO_TEXT] });
  });

  it("stays silent without a key: a value in an array, a JSX text, a prop", async () => {
    const row = '  return <tr>{["Lina Torres", "Marco Peña"].map((name) => <td key={name}>{name}</td>)}</tr>;';
    const array = { ...ordersApp(), [TABLE]: lines("export function OrdersTable() {", row, "}") };
    const found = await resolveElementDetails(MARCO, memoryReader(array), "repo");
    expect(found.resolved).toEqual([{ kind: "text", file: TABLE, line: 2, via: "repo", snippet: row.trim() }]);
    expect(found.shownBy).toBeUndefined();
    // Stage 0's answers carry no key: «Sales Report» is a prop (`title="Sales Report"`).
    expect(await resolveElementDetails(SALES_REPORT, memoryReader(FLOWBITE), "repo")).toEqual({ resolved: await resolveElement(SALES_REPORT, memoryReader(FLOWBITE), "repo") });
  });

  it("stays silent when the key is rendered only in forms it does not count ({format(order.customer)})", async () => {
    const formatted = ordersApp("      {ORDERS.map((order) => <tr><td>{format(order.customer)}</td></tr>)}");
    expect((await resolveElementDetails(MARCO, memoryReader(formatted), "repo")).shownBy).toBeUndefined();
  });

  it("resolveSession sets shownBy, drops a stale one, and the spec renders it", async () => {
    const out = await resolveSession(session([{ ...MARCO, shownBy: { key: "x", file: "src/old.tsx", line: 1, via: "repo" } }]), memoryReader(ordersApp(...MAPPED)), "repo");
    expect(out.events[0].element.shownBy).toEqual({ key: "customer", file: TABLE, line: 12, via: "repo", snippet: "<td>{order.customer}</td>" });
    const silent = await resolveSession(session([{ ...MARCO, shownBy: { key: "x", file: "src/old.tsx", line: 1, via: "repo" } }]), memoryReader(ordersApp()), "repo");
    expect(silent.events[0].element.shownBy).toBeUndefined();
  });
});

describe("propertyKey", () => {
  it("names the one property whose value is the element's text", () => {
    expect(propertyKey('  { id: "A-1041", customer: "Marco Peña", total: "$64.50" },', "Marco Peña")).toBe("customer");
    expect(propertyKey('  "customer": "Marco Peña",', "Marco Peña")).toBe("customer");
    expect(propertyKey("  { id: 'messages', label: 'Messages', badge: 3 },", "3")).toBe("badge");
    expect(propertyKey("    tab2Title: 'Top customers'", "Top customers")).toBe("tab2Title");
    expect(propertyKey("  { title: 'Active Now', value: 573 },", "Active Now +573")).toBe("title");
  });

  it("gives nothing without exactly one such property", () => {
    expect(propertyKey("<td>Marco Peña</td>", "Marco Peña")).toBeUndefined();
    expect(propertyKey('["Lina Torres", "Marco Peña"]', "Marco Peña")).toBeUndefined();
    expect(propertyKey('<More title="Marco Peña" />', "Marco Peña")).toBeUndefined();
    expect(propertyKey('ok ? "Marco Peña" : "Lina Torres"', "Lina Torres")).toBeUndefined();
    expect(propertyKey('{ name: "Marco Peña", alias: "Marco Peña" }', "Marco Peña")).toBeUndefined();
    expect(propertyKey("{ name: `${first} Peña` }", "Marco Peña")).toBeUndefined();
  });
});

describe("renderingsOf", () => {
  it("Django and Jinja templates: {{ x.key }}, with filters, never in comments or attributes", () => {
    const django = [
      "{# {{ order.customer }} #}", // 1
      '<tr title="{{ order.customer }}">', // 2
      "  <td>{{ order.customer|upper }}</td>", // 3
      "{% comment %}{{ order.customer }}{% endcomment %}", // 4
      "  <td>{{ order.customer_id }}</td>", // 5
      "  <td>{{ customer }}</td>", // 6
    ];
    expect(renderingsOf("customer", "templates/orders/list.html", django)).toEqual([3, 6]);
    expect(renderingsOf("customer", "templates/orders/row.jinja", ["<td>{{- row.customer | title -}}</td>"])).toEqual([1]);
    expect(renderingsOf("customer", "templates/orders/row.html", ["<td>{customer}</td>"])).toEqual([]);
  });

  it("Vue: mustaches only, never :attr or script", () => {
    const vue = ['<script setup>', "const { customer } = defineProps();", "</script>", '<td :title="order.customer">{{ order?.customer }}</td>'];
    expect(renderingsOf("customer", "src/Row.vue", vue)).toEqual([4]);
  });

  it("JSX and Svelte: element content, {@html}, not attributes, shorthand props or script", () => {
    const svelte = ["{@html item.label}", "<Row {label} />", "<p>{label}</p>", "<a href={item.label}>x</a>", "<!-- <p>{label}</p> -->"];
    expect(renderingsOf("label", "src/Item.svelte", svelte)).toEqual([1, 3]);
    const jsx = [
      "const { label } = item;",
      "use({ label });",
      "const x = `${item.label}`;",
      "return <li key={item.label}>",
      "  {item.label}",
      "</li>;",
      "// <b>{item.label}</b>",
    ];
    expect(renderingsOf("label", "src/Item.tsx", jsx)).toEqual([5]);
  });
});

/**
 * Resolver pass 2 (D9 note 2026-09-28): shadcn-admin's six-change set, a private React 19 + Vite
 * app's nav link, and elements with no text. Trimmed copies of the real files, at their real
 * line numbers where the line matters.
 */
describe("resolver pass 2 (D9 note 2026-09-28)", () => {
  const INDEX = "src/features/dashboard/index.tsx";
  const CARD = "src/components/ui/card.tsx";
  const LAYOUT = "src/components/layout/authenticated-layout.tsx";
  const pad = (n: number): string[] => Array.from({ length: n }, () => "");
  /** dashboard/index.tsx with «Overview» as a tab (:48), a card title (:165) and nav data (:195), «+20.1%…» at :81. */
  const dashboard = (cardTitle = "                  <CardTitle>Overview</CardTitle>"): Record<string, string> => ({
    [INDEX]: [
      "import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'",
      ...pad(46),
      "              <TabsTrigger value='overview'>Overview</TabsTrigger>", // 48
      ...pad(30),
      "                  <div className='text-2xl font-bold'>$45,231.89</div>", // 79
      "                  <p className='text-xs text-muted-foreground'>", // 80
      "                    +20.1% from last month", // 81
      "                  </p>", // 82
      ...pad(82),
      cardTitle, // 165
      ...pad(29),
      "    title: 'Overview',", // 195
    ].join("\n"),
    [CARD]: [
      "function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {",
      "  return <div data-slot='card-title' className={cn('leading-none font-semibold', className)} {...props} />",
      "}",
    ].join("\n"),
    [LAYOUT]: "export function AuthenticatedLayout() {\n  return <Outlet />\n}",
  });
  const overview = (extra: Partial<ElementInfo> = {}): ElementInfo =>
    el("div", "Overview", [{ component: "CardTitle", file: INDEX }, { component: "OutletImpl", file: LAYOUT }], {
      component: { framework: "react", name: "CardTitle" },
      ...extra,
    });

  it("item 1: breaks a JSX tie by the element's own component (the CardTitle, not the tab or the nav data)", async () => {
    expect(await resolveElement(overview(), memoryReader(dashboard()), "repo")).toEqual([
      { kind: "text", file: INDEX, line: 165, via: "repo", snippet: "<CardTitle>Overview</CardTitle>" },
    ]);
    // As the new capture records it, with the element's own file (card.tsx) first: the same line.
    const recorded = overview({ component: { framework: "react", name: "CardTitle", file: CARD } });
    expect(await resolveElement(recorded, memoryReader(dashboard()), "repo")).toMatchObject([{ file: INDEX, line: 165 }]);
  });

  it("item 1: silent when the tie cannot be told apart", async () => {
    // Two card titles with that text.
    const two = dashboard();
    two[INDEX] = two[INDEX].replace("<TabsTrigger value='overview'>Overview</TabsTrigger>", "<CardTitle>Overview</CardTitle>");
    expect(await resolveElement(overview(), memoryReader(two), "repo")).toEqual([]);
    // A card title that renders an expression could be showing the nav data's 'Overview'.
    const dynamic = dashboard();
    dynamic[INDEX] = `${dynamic[INDEX]}\n<CardTitle>{item.title}</CardTitle>`;
    expect(await resolveElement(overview(), memoryReader(dynamic), "repo")).toEqual([]);
    // A tag this reader cannot parse (an arrow in an attribute): no telling.
    const arrow = dashboard("                  <CardTitle onClick={() => go()}>Overview</CardTitle>");
    expect(await resolveElement(overview(), memoryReader(arrow), "repo")).toEqual([]);
  });

  it("item 1: reads the tag of JSX text on its own line", async () => {
    const multiline = dashboard("                  <CardTitle className='text-sm'>\n                    Overview\n                  </CardTitle>");
    expect(await resolveElement(overview(), memoryReader(multiline), "repo")).toMatchObject([{ file: INDEX, line: 166 }]);
  });

  it("item 2: a <p> written in a router-placed page is found in the page's file (renderedBy: [])", async () => {
    const p = el("p", "+20.1% from last month", [], { component: { framework: "react", name: "Dashboard", file: INDEX } });
    expect(codeChain(p)).toEqual([{ host: true, file: INDEX }]);
    expect(await resolveElement(p, memoryReader(dashboard()), "repo")).toEqual([
      { kind: "text", file: INDEX, line: 81, via: "repo", snippet: "+20.1% from last month" },
    ]);
    // Vue's file-only component is not where the tag is written (slot content): no chain from it.
    expect(codeChain({ ...p, component: { framework: "vue", name: "Dashboard", file: INDEX } })).toEqual([]);
  });

  /** A private React 19 + Vite app's shape (item A): the nav link's label in MainNav, a page-title switch in Shell. */
  const NAV_APP: Record<string, string> = {
    "src/layout/Shell.tsx": [
      'import { MainNav } from "./MainNav";',
      "function titleOf(path: string) {",
      "  switch (path) {",
      '    case "home": return "Home";',
      '    case "reports": return "Reports";',
      "  }",
      "}",
      "export function Shell() {",
      "  return <><MainNav /><h1>{titleOf(path)}</h1></>;",
      "}",
    ].join("\n"),
    "src/layout/MainNav.tsx": [
      "const ITEMS = [",
      '  { path: "/home", label: "Home" },',
      '  { path: "/reports", label: "Reports" },',
      "];",
      "export function MainNav() {",
      "  return <nav>{ITEMS.map((item) => <a key={item.path} href={item.path}>{item.label}</a>)}</nav>;",
      "}",
    ].join("\n"),
  };
  const reportsLink = el("a", "Reports", [{ component: "MainNav", file: "src/layout/Shell.tsx" }], {
    html: "<a>Reports</a>",
    component: { framework: "react", name: "MainNav" },
  });

  it("item A: a literal once in the usage file but also in the component's own definition is silence, not the usage's line", async () => {
    // Before pass 2: `text at: Shell.tsx:5`, the page-title switch. Wrong.
    expect(await resolveElement(reportsLink, memoryReader(NAV_APP), "repo")).toEqual([]);
    // With the link's href, written once, next to the label: the nav item's own line (rule 3's tie-break).
    const withHref = { ...reportsLink, html: '<a href="/reports">Reports</a>' };
    expect(await resolveElement(withHref, memoryReader(NAV_APP), "repo")).toMatchObject([{ kind: "text", file: "src/layout/MainNav.tsx", line: 3 }]);
    // The href twice (a second nav): silence again.
    const twoNavs = { ...NAV_APP, "src/layout/Shell.tsx": `${NAV_APP["src/layout/Shell.tsx"]}\nconst links = ["/reports"];` };
    expect(await resolveElement(withHref, memoryReader(twoNavs), "repo")).toEqual([]);
    // In a nav data module the definition imports: the same.
    const withData = {
      ...NAV_APP,
      "src/layout/MainNav.tsx": 'import { ITEMS } from "./nav";\nexport function MainNav() {\n  return <nav>{ITEMS.map((i) => <a href={i.path}>{i.label}</a>)}</nav>;\n}',
      "src/layout/nav.ts": 'export const ITEMS = [\n  { path: "/reports", label: "Reports" },\n];',
    };
    expect(await resolveElement(reportsLink, memoryReader(withData), "repo")).toEqual([]);
    // Without the title switch, the definition's line is found (rule 4, as before).
    const noSwitch = { ...NAV_APP, "src/layout/Shell.tsx": NAV_APP["src/layout/Shell.tsx"].replace('return "Reports"', 'return "Summary"') };
    expect(await resolveElement(reportsLink, memoryReader(noSwitch), "repo")).toMatchObject([{ file: "src/layout/MainNav.tsx", line: 3 }]);
  });

  it("item A: the same for Vue, whose frames are also where each instance is used", async () => {
    const vue = {
      "src/layout/Shell.vue":
        '<script setup>\nimport MainNav from "./MainNav.vue";\nconst title = computed(() => (route.name === "reports" ? "Reports" : "Home"));\n</script>\n<template><MainNav /><h1>{{ title }}</h1></template>',
      "src/layout/MainNav.vue":
        '<script setup>\nconst items = [{ path: "/reports", label: "Reports" }];\n</script>\n<template><a v-for="i in items" :href="i.path">{{ i.label }}</a></template>',
    };
    const link = el("a", "Reports", [{ component: "MainNav", file: "src/layout/Shell.vue" }], {
      component: { framework: "vue", name: "MainNav", file: "src/layout/MainNav.vue" },
    });
    expect(await resolveElement(link, memoryReader(vue), "repo")).toEqual([]);
  });

  it("item B: class at for an element with no text, on its own tag only, once", async () => {
    const MAP = "src/features/orders/OrdersMap.tsx";
    const files: Record<string, string> = {
      "src/features/orders/index.tsx": 'import { OrdersMap } from "./OrdersMap";\nexport function OrdersPage() {\n  return <OrdersMap />;\n}',
      [MAP]: 'export function OrdersMap() {\n  return (\n    <div\n      className="orders-map absolute inset-0"\n      ref={ref}\n    />\n  );\n}',
    };
    const layer = el("div", "", [{ component: "OrdersMap", file: "src/features/orders/index.tsx" }], {
      html: '<div class="orders-map absolute inset-0"></div>',
      component: { framework: "react", name: "OrdersMap" },
    });
    expect(await resolveElement(layer, memoryReader(files), "repo")).toEqual([
      { kind: "class", file: MAP, line: 4, via: "repo", snippet: 'className="orders-map absolute inset-0"' },
    ]);
    // Written twice: silent. Only utilities: nothing to look up. On a component, not the element's own tag: silent.
    expect(await resolveElement(layer, memoryReader({ ...files, [MAP]: `${files[MAP]}\nconst other = <div className="orders-map" />;` }), "repo")).toEqual([]);
    expect(await resolveElement({ ...layer, html: '<div class="absolute inset-0"></div>' }, memoryReader(files), "repo")).toEqual([]);
    const wrapper = { ...files, [MAP]: 'export function OrdersMap() {\n  return <Layer className="orders-map" />;\n}' };
    expect(await resolveElement(layer, memoryReader(wrapper), "repo")).toEqual([]);
    // An id, the same way.
    const byId = { ...files, [MAP]: 'export function OrdersMap() {\n  return <div id="orders-map-canvas" />;\n}' };
    expect(await resolveElement({ ...layer, html: '<div id="orders-map-canvas"></div>' }, memoryReader(byId), "repo")).toMatchObject([{ kind: "id", file: MAP, line: 2 }]);
    // An element with text of its own never gets one.
    expect(await resolveElement({ ...layer, text: "Map" }, memoryReader(files), "repo")).toEqual([]);
  });
});
