import { describe, expect, it } from "vitest";
import type { CapturedEvent, CodeFrame, ElementInfo, SessionFile } from "../schema";
import { codeChain } from "./chain";
import { FLOWBITE, SHADCN, memoryReader } from "./eval-fixtures";
import { cachingReader, MAX_SNIPPET_CHARS, projectMatch, resolveElement, resolveSession, sourceSnippet } from "./resolve";

/** Elements as the extension recorded them in the evaluation (eval/.runs/sessions), plus a chain. */
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
    // What a Vite dev server actually does (reproduced from examples/react-dashboard, 2026-09-27):
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
    expect(reader.reads).toContain("src/components/layout/data/sidebar-data.ts");
    expect(reader.reads.every((path) => path.startsWith("src/components/") || path.startsWith("src/lib/"))).toBe(true);
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
 * The shape of examples/react-dashboard, with the sidebar importing its own data (the common
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

/** The same sidebar in Vue (examples/vue-dashboard): the element's own component file comes from `__file`. */
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

/** The Messages badge exactly as the extension captured it on examples/react-dashboard: no href anywhere. */
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
    // vuestic-admin's notification badge (eval/.apps, lines 1-6 verbatim): the badge is alone in its
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
    // Nothing beyond the chain's own files was read for them.
    expect(new Set(reader.reads)).toEqual(new Set(["src/lib/ChartWidget.svelte", DASHBOARD, PAGE]));
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
