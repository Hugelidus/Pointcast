import { describe, expect, it } from "vitest";
import { codeFirstLines, codePointerLines } from "./code-pointer";
import { renderMarkdown } from "./render";
import { FLOWBITE, SHADCN, VUESTIC, memoryReader } from "./resolve/eval-fixtures";
import { resolveElement, resolveSession } from "./resolve/resolve";
import type { CapturedEvent, ElementInfo, SessionFile, Word, WordsFile } from "./schema";

const DASHBOARD = "src/routes/utils/dashboard/Dashboard.svelte";
const PAGE = "src/routes/(sidebar)/+page.svelte";
const FLOWBITE_LIB = "node_modules/.pnpm/flowbite-svelte@1.28.1_rollup@4.53.2_svelte@5.43.10_tailwindcss@4.1.17/node_modules/flowbite-svelte/dist";

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function point(id: string, t: number, element: ElementInfo): CapturedEvent {
  return { id, gesture: "point", tStart: t, tEnd: t, url: "http://127.0.0.1:5544/", element };
}

/**
 * Four of the five gestures of the flowbite-svelte-admin evaluation session, as recorded, with the
 * chains Stage 0 used. Svelte gives renderedBy from the element's instance outwards and the
 * element's own location in `component` (More.svelte:18).
 */
const FLOWBITE_SESSION: SessionFile = {
  schemaVersion: 2,
  id: "2026-09-27_06-09-34",
  startedAt: "2026-09-27T04:09:34.000Z",
  t0: 1790000000000,
  durationMs: 32000,
  recorder: { extensionVersion: "0.1.0", userAgent: "test" },
  events: [
    point("e1", 5770, {
      tag: "a",
      text: "Sales Report",
      context: "$45,385 · Sales this week",
      selector: "div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(2) > a",
      selectorUnique: true,
      path: "main › a",
      html: '<a href="#top">Sales Report <svg/></a>',
      component: { framework: "svelte", name: "More", file: "src/lib/More.svelte", line: 18, column: 2 },
      renderedBy: [
        { component: "More", file: "src/lib/ChartWidget.svelte", line: 27 },
        { component: "ChartWidget", file: DASHBOARD, line: 112 },
        { component: "Dashboard", file: PAGE, line: 14 },
      ],
    }),
    point("e2", 10336, {
      tag: "button",
      text: "Top customers",
      context: "Statistics this month · Show information",
      selector: "#s3",
      selectorUnique: true,
      path: "main › ul[role=tablist] › li[role=presentation][2] › button#s3",
      html: '<button type="button" role="tab" id="s3" aria-controls="tab-panel-s1">Top customers</button>',
      component: { framework: "svelte", name: "TabItem", file: `${FLOWBITE_LIB}/tabs/TabItem.svelte`, line: 42, column: 2 },
      renderedBy: [
        { component: "TabItem", file: "src/lib/Stats.svelte", line: 55 },
        { component: "Stats", file: DASHBOARD, line: 113 },
        { component: "Dashboard", file: PAGE, line: 14 },
      ],
    }),
    point("e3", 15217, {
      tag: "h5",
      text: "Users",
      selector: "div:nth-of-type(3) > div:nth-of-type(1) > h5",
      selectorUnique: true,
      path: "main › h5",
      html: "<h5>Users</h5>",
      component: { framework: "svelte", name: "Heading", file: `${FLOWBITE_LIB}/typography/heading/Heading.svelte`, line: 14 },
      renderedBy: [
        { component: "Heading", file: "src/lib/ProductMetricCard.svelte", line: 11 },
        { component: "ProductMetricCard", file: DASHBOARD, line: 133 },
        { component: "Dashboard", file: PAGE, line: 14 },
      ],
    }),
    {
      ...point("e4", 25596, {
        tag: "p",
        text: "Sales this week",
        context: "$45,385",
        selector: "div > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > p",
        selectorUnique: true,
        path: "main › p",
        html: "<p>Sales this week</p>",
        component: { framework: "svelte", name: "P", file: `${FLOWBITE_LIB}/typography/paragraph/P.svelte`, line: 27 },
        renderedBy: [
          { component: "P", file: "src/lib/ChartWidget.svelte", line: 19 },
          { component: "ChartWidget", file: DASHBOARD, line: 112 },
          { component: "Dashboard", file: PAGE, line: 14 },
        ],
      }),
      gesture: "select",
      tEnd: 25634,
      selection: { text: "Sales this week" },
    },
  ],
};

/** Whisper's words for those sentences in the same recording. */
const FLOWBITE_WORDS: WordsFile = {
  schemaVersion: 1,
  engine: "local:Xenova/whisper-base",
  language: "es",
  words: [
    w(" Este", 6000, 6120), w(" enlace", 6120, 6480), w(" que", 6480, 6680), w(" ponga", 6680, 6840),
    w(" a", 6840, 6920), w(" ver", 6920, 7200), w(" informe", 7200, 7800), w(" completo.", 7800, 10040),
    w(" Esta", 10580, 10680), w(" pestaña", 10680, 11240), w(" debería", 11240, 11680), w(" salir", 11680, 11880),
    w(" abierta", 11880, 12300), w(" por", 12300, 12560), w(" defecto.", 12560, 12840),
    w(" Esta", 15450, 15670), w(" tarjeta", 15670, 16090), w(" está", 16090, 16350), w(" repetida,", 16350, 17150),
    w(" borrala.", 17310, 18090),
    w(" El", 25610, 25870), w(" subtítulo", 25870, 26250), w(" de", 26250, 26470), w(" sales", 26470, 26670),
    w(" de", 26670, 26810), w(" Yswick,", 26810, 27330), w(" cambia", 27690, 27910), w(" lo", 27910, 28110),
    w(" por", 28110, 28310), w(" ventas", 28310, 28550), w(" de", 28550, 28650), w(" la", 28650, 29010),
    w(" semana.", 29010, 29970),
  ],
};

function el(tag: string, text: string, extra: Partial<ElementInfo>): ElementInfo {
  return { tag, text, selector: tag, selectorUnique: true, path: `main › ${tag}`, html: "", ...extra };
}

describe("code pointer rendering", () => {
  it("renders the Stage 0 chain and the resolved lines in the dom-first layout, as before snippets existed", async () => {
    const resolved = await resolveSession(FLOWBITE_SESSION, memoryReader(FLOWBITE), "repo");
    const md = renderMarkdown(resolved, FLOWBITE_WORDS, { format: "requests", layout: "dom-first" });
    // Unchanged since the code pointer was built: the snapshot file predates the code-first layout.
    await expect(md).toMatchFileSnapshot("__snapshots__/code-pointer.requests.md");
  });

  it("gives the classic appendix the same lines", async () => {
    const resolved = await resolveSession(FLOWBITE_SESSION, memoryReader(FLOWBITE), "repo");
    const md = renderMarkdown(resolved, FLOWBITE_WORDS, { format: "classic" });
    expect(md).toContain(
      "- code: `<a>` inside `src/lib/More.svelte:18` ← `<More>` at `src/lib/ChartWidget.svelte:27` ← `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`\n" +
        "- text at: `src/lib/ChartWidget.svelte:27`\n",
    );
  });

  it("renders a nameless first frame as an unnamed component, not the shared host tag, and points at the sidebar data", async () => {
    // The extension never puts the element's own tag into renderedBy (framework-main.ts): a
    // nameless frame here is an anonymous instance in badge.tsx (e.g. Radix's Slot/`Comp`), not
    // the `<span>` itself.
    const badge = el("span", "3", {
      selector: 'a[href="/chats"] > span:nth-of-type(2)',
      renderedBy: [
        { file: "src/components/ui/badge.tsx", line: 37 },
        { component: "Badge", file: "src/components/layout/nav-group.tsx", line: 62 },
        { component: "NavBadge", file: "src/components/layout/nav-group.tsx", line: 77 },
        { component: "NavGroup", file: "src/components/layout/app-sidebar.tsx", line: 28 },
      ],
    });
    const resolved = await resolveElement(badge, memoryReader(SHADCN), "repo");
    expect(codePointerLines({ ...badge, resolved })).toEqual([
      "code: component at `src/components/ui/badge.tsx:37` ← `<Badge>` at `src/components/layout/nav-group.tsx:62` ← `<NavGroup>` at `src/components/layout/app-sidebar.tsx:28`",
      "data at: `src/components/layout/data/sidebar-data.ts:73`",
    ]);
  });

  it("keeps at/in when the text is in the innermost file, and without anything resolved", () => {
    // vuestic-admin's «Total earnings»: Vue gives files only, and the first frame is nameless
    // (an unnamed component instance, not the `<p>` tag itself).
    const total = el("p", "Total earnings", {
      renderedBy: [
        { file: "src/pages/admin/dashboard/cards/RevenueReport.vue" },
        { component: "RevenueReport", file: "src/pages/admin/dashboard/Dashboard.vue" },
        { component: "Dashboard", file: "src/layouts/AppLayout.vue" },
      ],
      resolved: [{ kind: "text", file: "src/pages/admin/dashboard/cards/RevenueReport.vue", line: 14, via: "repo" }],
    });
    expect(codePointerLines(total)).toEqual([
      "code: component in `src/pages/admin/dashboard/cards/RevenueReport.vue` ← `<RevenueReport>` in `src/pages/admin/dashboard/Dashboard.vue` ← `<Dashboard>` in `src/layouts/AppLayout.vue`",
      "text at: `src/pages/admin/dashboard/cards/RevenueReport.vue:14`",
    ]);
    const { resolved: _, ...unresolved } = total;
    expect(codePointerLines(unresolved)[0]).toMatch(/^code: component in /);
  });

  it("renders a nameless first frame as an unnamed component (React 19, no leading library frame)", () => {
    // shadcn-admin's chart, as framework-main.ts actually captures it: recharts' own node_modules
    // frame is filtered out at capture time (never reaches renderedBy), so there is no droppedPackage
    // to name the chart's package, unlike the "drops library and generated frames" fixture above.
    const chart = el("div", "", {
      renderedBy: [
        { file: "src/features/dashboard/components/overview.tsx", line: 57 },
        { component: "Overview", file: "src/features/dashboard/index.tsx", line: 168 },
        { component: "OutletImpl", file: "src/components/layout/authenticated-layout.tsx", line: 36 },
      ],
    });
    expect(codePointerLines(chart)).toEqual([
      "code: component at `src/features/dashboard/components/overview.tsx:57` ← `<Overview>` at `src/features/dashboard/index.tsx:168` ← `<OutletImpl>` at `src/components/layout/authenticated-layout.tsx:36`",
    ]);
  });

  it("renders a nameless first frame as an unnamed component (Vue, files only)", () => {
    // vuestic-admin's Monthly Earnings chart: the canvas that LineChart.vue hands to Chart.js.
    const canvas = el("canvas", "", {
      component: { framework: "vue", name: "LineChart", file: "src/components/va-charts/chart-types/LineChart.vue" },
      renderedBy: [
        { file: "src/components/va-charts/chart-types/LineChart.vue" },
        { component: "LineChart", file: "src/components/va-charts/VaChart.vue" },
        { component: "VaChart", file: "src/pages/admin/dashboard/cards/MonthlyEarnings.vue" },
      ],
    });
    expect(codePointerLines(canvas)).toEqual([
      "code: component in `src/components/va-charts/chart-types/LineChart.vue` ← `<LineChart>` in `src/components/va-charts/VaChart.vue` ← `<VaChart>` in `src/pages/admin/dashboard/cards/MonthlyEarnings.vue`",
    ]);
  });

  it("drops library and generated frames, names them by package, keeps 3 project-relative frames", () => {
    // shadcn-admin's chart: recharts' unnamed component, from Vite's pre-bundled deps.
    const chart = el("div", "", {
      renderedBy: [
        { file: "node_modules/.vite/deps/recharts.js?v=1a2b3c", line: 9 },
        { file: "C:/Users/someone/Desktop/shadcn-admin/src/features/dashboard/components/overview.tsx", line: 57 },
        { component: "Overview", file: "src/features/dashboard/index.tsx", line: 168 },
        { component: "OutletImpl", file: "src/components/layout/authenticated-layout.tsx", line: 36 },
        { component: "AuthenticatedLayout", file: "src/routes/_authenticated/route.tsx", line: 5 },
      ],
    });
    expect(codePointerLines(chart)).toEqual([
      "code: recharts component at `src/features/dashboard/components/overview.tsx:57` ← `<Overview>` at `src/features/dashboard/index.tsx:168` ← `<OutletImpl>` at `src/components/layout/authenticated-layout.tsx:36`",
    ]);
  });

  // A shadcn dropdown trigger on Radix: the wrappers (Primitive, SlotClone, Slot, Presence, Portal)
  // come first and outnumber the cap. They are skipped before it, whatever form their path has,
  // so the 3 places go to the app's frames, and no node_modules path is printed.
  it("skips Radix-style library wrappers before the 3-frame cap", () => {
    const pnpm = "node_modules/.pnpm/@radix-ui+react-primitive@2.1.3_react@19.1.0/node_modules/@radix-ui/react-primitive/dist/index.mjs";
    const trigger = el("button", "Account", {
      component: { framework: "react", name: "Primitive.button", file: pnpm, line: 38 },
      renderedBy: [
        { component: "Primitive.button", file: pnpm, line: 38 },
        { component: "SlotClone", file: "C:/Users/someone/app/node_modules/@radix-ui/react-slot/dist/index.mjs", line: 61 },
        { component: "Slot", file: "node_modules/.vite/deps/@radix-ui_react-slot.js?v=9f1c" },
        { component: "Presence", file: "_next/static/chunks/node_modules_@radix-ui_react-presence_dist_index_mjs_1a2b._.js" },
        { component: "Portal", file: "node_modules\\@radix-ui\\react-portal\\dist\\index.mjs", line: 12 },
        // Written by Radix's own DropdownMenuTrigger: its package names the next (app) frame.
        {
          component: "Primitive.button",
          file: "node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.1.15/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs",
          line: 90,
        },
        { component: "DropdownMenuTrigger", file: "src/components/ui/dropdown-menu.tsx", line: 12 },
        { component: "NavUser", file: "src/components/layout/app-sidebar.tsx", line: 31 },
        { component: "AppSidebar", file: "src/components/layout/authenticated-layout.tsx", line: 20 },
      ],
    });
    const lines = [...codePointerLines(trigger), ...codeFirstLines(trigger)];
    expect(codePointerLines(trigger)).toEqual([
      "code: @radix-ui/react-dropdown-menu `<DropdownMenuTrigger>` at `src/components/ui/dropdown-menu.tsx:12` ← `<NavUser>` at `src/components/layout/app-sidebar.tsx:31` ← `<AppSidebar>` at `src/components/layout/authenticated-layout.tsx:20`",
    ]);
    expect(lines.join("\n")).not.toMatch(/node_modules|\.pnpm|Primitive|Slot|Presence/);

    // The nearest wrapper's package is unknown (a flattened chunk name): no package is named,
    // never an earlier wrapper's.
    const frames = trigger.renderedBy ?? [];
    const presence = frames[3];
    const unknown = { ...trigger, renderedBy: [...frames.slice(0, 5), presence, ...frames.slice(6)] };
    expect(codePointerLines(unknown)[0]).toMatch(/^code: `<DropdownMenuTrigger>` at `src\/components\/ui\/dropdown-menu\.tsx:12` ← /);
  });

  it("adds nothing to elements recorded before renderedBy and resolved existed", () => {
    expect(codePointerLines(el("h1", "Settings", { component: { framework: "svelte", name: "Page", file: "src/App.svelte", line: 3 } }))).toEqual([]);
  });
});

function sessionOf(events: CapturedEvent[]): SessionFile {
  return { ...FLOWBITE_SESSION, id: "2026-09-27_07-00-00", events };
}

/** The element's code-first lines once a session holding it is resolved against `files`. */
async function codeFirst(element: ElementInfo, files: Record<string, string>): Promise<string[]> {
  const resolved = await resolveSession(sessionOf([point("e1", 0, element)]), memoryReader(files), "repo");
  return codeFirstLines(resolved.events[0].element);
}

/** shadcn-admin's Chats badge as recorded, with the chain Stage 0 used (the probe's nameless first frame). */
const CHATS_BADGE: ElementInfo = {
  tag: "span",
  text: "3",
  selector: 'a[href="/chats"] > span:nth-of-type(2)',
  selectorUnique: true,
  path: "div#root › ul › li[4] › span[2]",
  html: "<span>3</span>",
  component: { framework: "react", name: "Badge" },
  renderedBy: [
    { file: "src/components/ui/badge.tsx", line: 37 },
    { component: "Badge", file: "src/components/layout/nav-group.tsx", line: 62 },
    { component: "NavBadge", file: "src/components/layout/nav-group.tsx", line: 77 },
    { component: "NavGroup", file: "src/components/layout/app-sidebar.tsx", line: 28 },
  ],
};

/** The same app's «You made 265 sales this month.» as a production build records it: no code information. */
const RECENT_SALES: ElementInfo = {
  tag: "div",
  text: "You made 265 sales this month.",
  context: "Recent Sales",
  selector: "main > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div:nth-of-type(2)",
  selectorUnique: true,
  path: "main › div › div[2] › div › div › div[2]",
  html: "<div>You made 265 sales this month.</div>",
};

const SHADCN_WORDS: WordsFile = {
  schemaVersion: 1,
  engine: "local:Xenova/whisper-base",
  language: "es",
  words: [
    w(" Quita", 0, 300), w(" este", 300, 500), w(" número", 500, 900), w(" del", 900, 1000), w(" menú.", 1000, 1500),
    w(" Y", 3000, 3100), w(" este", 3100, 3300), w(" texto,", 3300, 3700), w(" cámbialo", 3700, 4200), w(" por", 4200, 4400),
    w(" últimas", 4400, 4800), w(" ventas", 4800, 5100), w(" del", 5100, 5200), w(" mes.", 5200, 5600),
  ],
};

describe("code-first layout (the requests default)", () => {
  it("renders the flowbite session code-first", async () => {
    const resolved = await resolveSession(FLOWBITE_SESSION, memoryReader(FLOWBITE), "repo");
    await expect(renderMarkdown(resolved, FLOWBITE_WORDS)).toMatchFileSnapshot("__snapshots__/code-pointer.requests.code-first.md");
  });

  it("flowbite «Sales Report»: the exact instance and its line; the shared More only as its definition", async () => {
    expect(await codeFirst(FLOWBITE_SESSION.events[0].element, FLOWBITE)).toEqual([
      'used at: `src/lib/ChartWidget.svelte:27` — `<More title="Sales Report" href="#top" />`',
      "defined in: `src/lib/More.svelte` (shared — do not change it unless asked)",
      "text at: `src/lib/ChartWidget.svelte:27` (same as used at)",
      "within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112`",
    ]);
  });

  it("flowbite «Sales this week»: the library P where the app uses it, the text where the instance passes it", async () => {
    const resolved = await resolveSession(sessionOf([FLOWBITE_SESSION.events[3]]), memoryReader(FLOWBITE), "repo");
    expect(codeFirstLines(resolved.events[0].element)).toEqual([
      'used at: `src/lib/ChartWidget.svelte:19` — `<P class="text-base font-light text-gray-500 dark:text-gray-300">{subtitle}</P>`',
      "defined in: package `flowbite-svelte`",
      'text at: `src/routes/utils/dashboard/Dashboard.svelte:112` — `<ChartWidget value={12.5} {chartOptions} title="$45,385" subtitle="Sales this week" />`',
      "within: `<ChartWidget>` at `src/routes/utils/dashboard/Dashboard.svelte:112` ← `<Dashboard>` at `src/routes/(sidebar)/+page.svelte:14`",
    ]);
  });

  it("tells apart two instances of the shared More: one definition, two call sites", async () => {
    const other: ElementInfo = {
      ...FLOWBITE_SESSION.events[0].element,
      context: "Sales by category · Desktop PC",
      renderedBy: [
        { component: "More", file: "src/lib/CategorySalesReport.svelte", line: 41 },
        { component: "CategorySalesReport", file: DASHBOARD, line: 158 },
        { component: "Dashboard", file: PAGE, line: 14 },
      ],
    };
    expect(await codeFirst(other, FLOWBITE)).toEqual([
      'used at: `src/lib/CategorySalesReport.svelte:41` — `<More title="Sales Report" href="#top" />`',
      "defined in: `src/lib/More.svelte` (shared — do not change it unless asked)",
      "text at: `src/lib/CategorySalesReport.svelte:41` (same as used at)",
      "within: `<CategorySalesReport>` at `src/routes/utils/dashboard/Dashboard.svelte:158`",
    ]);
  });

  it("shadcn Chats badge: the NavBadge call site, the shared badge.tsx, and the sidebar data line", async () => {
    expect(await codeFirst(CHATS_BADGE, SHADCN)).toEqual([
      "used at: `src/components/layout/nav-group.tsx:62` — `return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>`",
      "defined in: `src/components/ui/badge.tsx` (shared — do not change it unless asked)",
      "data at: `src/components/layout/data/sidebar-data.ts:73` — `url: '/chats', badge: '3', icon: MessagesSquare,`",
      "within: `<NavGroup>` at `src/components/layout/app-sidebar.tsx:28`",
    ]);
  });

  it("vuestic «Export»: files only, so the instance is named; the text line is quoted", async () => {
    const exportButton = el("button", "Export", {
      component: { framework: "vue", name: "VaButton" },
      renderedBy: [
        { component: "VaButton", file: "src/pages/admin/dashboard/cards/RevenueReport.vue" },
        { component: "RevenueReport", file: "src/pages/admin/dashboard/Dashboard.vue" },
        { component: "Dashboard", file: "src/layouts/AppLayout.vue" },
      ],
    });
    expect(await codeFirst(exportButton, VUESTIC)).toEqual([
      "used at: `src/pages/admin/dashboard/cards/RevenueReport.vue` — `<VaButton>`",
      'text at: `src/pages/admin/dashboard/cards/RevenueReport.vue:7` — `<VaButton class="h-2" size="small" preset="primary" @click="exportAsCSV">Export</VaButton>`',
      "within: `<RevenueReport>` in `src/pages/admin/dashboard/Dashboard.vue` ← `<Dashboard>` in `src/layouts/AppLayout.vue`",
    ]);
  });

  it("without source read (no snippets, nothing resolved): no shared mark without evidence", () => {
    // A Svelte tag written in a component, nothing resolved: its file is the definition, not marked shared.
    const heading = el("h1", "Settings", {
      component: { framework: "svelte", name: "Page", file: "src/lib/Page.svelte", line: 3 },
      renderedBy: [{ component: "Page", file: "src/routes/+page.svelte", line: 5 }],
    });
    expect(codeFirstLines(heading)).toEqual(["used at: `src/routes/+page.svelte:5` — `<Page>`", "defined in: `src/lib/Page.svelte`"]);
    // A nameless first frame without evidence stays the instance (the shadcn chart, recharts' BarChart).
    const chart = el("div", "", {
      renderedBy: [
        { file: "src/features/dashboard/components/overview.tsx", line: 57 },
        { component: "Overview", file: "src/features/dashboard/index.tsx", line: 168 },
      ],
    });
    expect(codeFirstLines(chart)).toEqual([
      "used at: `src/features/dashboard/components/overview.tsx:57`",
      "within: `<Overview>` at `src/features/dashboard/index.tsx:168`",
    ]);
  });

  it("renders the shadcn badge code-first next to an element without code information, which stays DOM-first", async () => {
    const recorded = sessionOf([point("e1", 400, CHATS_BADGE), point("e2", 3200, RECENT_SALES)]);
    const resolved = await resolveSession(recorded, memoryReader(SHADCN), "repo");
    const md = renderMarkdown(resolved, SHADCN_WORDS);
    await expect(md).toMatchFileSnapshot("__snapshots__/code-pointer.shadcn.code-first.md");

    // The element without code information: exactly what the requests format rendered before.
    const noCode = [
      "- [a] div «You made 265 sales this month.» in «Recent Sales» on `/`",
      "  - in: `main › div › div[2] › div › div › div[2]`",
    ].join("\n");
    expect(md).toContain(`\n\n${noCode}\n\n`);
    expect(renderMarkdown(resolved, SHADCN_WORDS, { layout: "dom-first" })).toContain(`\n\n${noCode}\n\n`);
  });

  it("never quotes source for a sensitive element, even from a hand-edited session", () => {
    const field = el("input", "", {
      sensitive: true,
      renderedBy: [{ component: "TokenField", file: "src/Settings.svelte", line: 4, snippet: "<TokenField value=\"sk-123\" />" }],
      resolved: [{ kind: "text", file: "src/Settings.svelte", line: 4, via: "repo", snippet: "<TokenField value=\"sk-123\" />" }],
    });
    expect(codeFirstLines(field)).toEqual([
      "used at: `src/Settings.svelte:4` — `<TokenField>`",
      "text at: `src/Settings.svelte:4` (same as used at)",
    ]);
  });

  it("renders a session without code information byte-identical in both layouts, without the code preamble line", () => {
    const plain = sessionOf([point("e1", 3200, RECENT_SALES)]);
    const md = renderMarkdown(plain, SHADCN_WORDS);
    expect(md).toBe(renderMarkdown(plain, SHADCN_WORDS, { layout: "dom-first" }));
    expect(md).not.toContain("used at");
  });
});

describe("server templates (pointcast-django, D9 note 2026-09-28)", () => {
  const STATUS = "pim/templates/pim/partials/status.html";
  const badge: ElementInfo = {
    tag: "span",
    text: "Activo",
    selector: "span.badge",
    selectorUnique: false,
    path: "main › table › span",
    html: '<span class="badge">Activo</span>',
    component: { framework: "django", name: "pim/partials/status.html", file: STATUS },
    renderedBy: [
      { file: STATUS, component: "pim/partials/status.html" },
      { file: "templates/pim/partials/row.html", component: "pim/partials/row.html" },
      { file: "templates/pim/list.html", component: "pim/list.html" },
    ],
    resolved: [{ kind: "text", file: STATUS, line: 1, via: "repo", snippet: '<span class="badge">{% if product.active %}Activo{% else %}Inactivo{% endif %}</span>' }],
  };

  it("names templates by their file, not as <components>", () => {
    expect(codeFirstLines(badge)).toEqual([
      `template: \`${STATUS}\``,
      `text at: \`${STATUS}:1\` — \`<span class="badge">{% if product.active %}Activo{% else %}Inactivo{% endif %}</span>\``,
      "within: template `templates/pim/partials/row.html` ← template `templates/pim/list.html`",
    ]);
    expect(codePointerLines(badge)).toEqual([
      `code: template \`${STATUS}\` ← template \`templates/pim/partials/row.html\` ← template \`templates/pim/list.html\``,
      `text at: \`${STATUS}:1\``,
    ]);
  });
});
