import type { SourceReader } from "./resolve";

/**
 * Test fixtures: the few source lines the resolver needs from the three evaluation apps
 * (eval/.apps, see docs/eval/stage0-code-pointer-2026-09-27.md), copied verbatim at their real
 * line numbers. Every other line is blank, so a location found here is the one found in the app.
 */

function sparse(lines: Record<number, string>): string {
  const last = Math.max(...Object.keys(lines).map(Number));
  return Array.from({ length: last }, (_, i) => lines[i + 1] ?? "").join("\n");
}

/** themesberg/flowbite-svelte-admin-dashboard (Svelte 5). */
export const FLOWBITE: Record<string, string> = {
  "src/lib/More.svelte": sparse({
    18: "  <a {href} class={aClass}>",
    19: "    {title}",
  }),
  "src/lib/ChartWidget.svelte": sparse({
    2: "  import { Change } from '$lib';",
    4: "  import { Card, Heading, P } from 'flowbite-svelte';",
    6: "  import { DateRangeSelector, More } from '$lib';",
    7: "  import type { ChartWidgetProps } from './types';",
    18: '      <Heading tag="h3" class={headingCls}>{title}</Heading>',
    19: '      <P class="text-base font-light text-gray-500 dark:text-gray-300">{subtitle}</P>',
    27: '    <More title="Sales Report" href="#top" />',
  }),
  "src/lib/CategorySalesReport.svelte": sparse({
    4: "  import { Change, More, DateRangeSelector } from '$lib';",
    41: '    <More title="Sales Report" href="#top" />',
  }),
  "src/lib/ProductMetricCard.svelte": sparse({
    11: "    <Heading tag={headingTag}>{title}</Heading>",
  }),
  "src/lib/Stats.svelte": sparse({
    55: '    <TabItem class="w-full">',
    57: "        {tab2Title}",
  }),
  "src/routes/utils/dashboard/Dashboard.svelte": sparse({
    9: "  import { ChartWidget, Stats, More, ActivityList, ProductMetricCard, CategorySalesReport, DarkChart, Traffic, getChartOptions } from '$lib';",
    76: "    title: 'Statistics this month',",
    77: "    popoverTitle: 'Statistics',",
    78: "    tab1Title: 'Top products',",
    79: "    tab2Title: 'Top customers'",
    112: '    <ChartWidget value={12.5} {chartOptions} title="$45,385" subtitle="Sales this week" />',
    113: "    <Stats {products} {customers} {...statsCont}>",
    116: '        <More title="Read more" href="#top" flat />',
    127: "    <ProductMetricCard title=\"Users\" subTitle=\"4,420\" changeProps={{ size: 'sm', value: -3.4, since: 'Since last month' }}>",
    133: "    <ProductMetricCard title=\"Users\" subTitle=\"4,420\" changeProps={{ size: 'sm', value: -3.4, since: 'Since last month' }}>",
    158: "      <CategorySalesReport title=\"Sales by category\" subtitle=\"Desktop PC\" changeProps={{ value: 2.5, since: 'Since last month', size: 'sm' }}>",
  }),
  "src/routes/(sidebar)/+page.svelte": sparse({
    14: "  <Dashboard />",
  }),
};

/** satnaing/shadcn-admin (React 19). */
export const SHADCN: Record<string, string> = {
  "src/components/ui/badge.tsx": sparse({
    4: "import { cn } from '@/lib/utils'",
    34: "  const Comp = asChild ? Slot : 'span'",
    37: "    <Comp",
  }),
  "src/components/layout/nav-group.tsx": sparse({
    20: "import { Badge } from '../ui/badge'",
    34: "} from './types'",
    47: "            return <SidebarMenuLink key={key} item={item} href={href} />",
    62: "  return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>",
    74: "        <Link to={item.url} onClick={() => setOpenMobile(false)}>",
    76: "          <span>{item.title}</span>",
    77: "          {item.badge && <NavBadge>{item.badge}</NavBadge>}",
  }),
  "src/components/layout/app-sidebar.tsx": sparse({
    10: "import { sidebarData } from './data/sidebar-data'",
    11: "import { NavGroup } from './nav-group'",
    12: "import { NavUser } from './nav-user'",
    13: "import { TeamSwitcher } from './team-switcher'",
    27: "        {sidebarData.navGroups.map((props) => (",
    28: "          <NavGroup key={props.title} {...props} />",
  }),
  "src/components/layout/data/sidebar-data.ts": sparse({
    26: "import { type SidebarData } from '../types'",
    51: "  navGroups: [",
    52: "    {",
    53: "      title: 'General',",
    54: "      items: [",
    55: "        {",
    56: "          title: 'Dashboard',",
    57: "          url: '/',",
    58: "          icon: LayoutDashboard,",
    59: "        },",
    60: "        {",
    61: "          title: 'Tasks',",
    62: "          url: '/tasks',",
    63: "          icon: ListTodo,",
    64: "        },",
    65: "        {",
    66: "          title: 'Apps',",
    67: "          url: '/apps',",
    68: "          icon: Package,",
    69: "        },",
    70: "        {",
    71: "          title: 'Chats',",
    72: "          url: '/chats',",
    73: "          badge: '3',",
    74: "          icon: MessagesSquare,",
    75: "        },",
    76: "        {",
    77: "          title: 'Users',",
    78: "          url: '/users',",
    79: "          icon: Users,",
    80: "        },",
  }),
};

/** epicmaxco/vuestic-admin (Vue 3: the chain gives files only, no lines). */
export const VUESTIC: Record<string, string> = {
  "src/pages/admin/dashboard/cards/RevenueReport.vue": sparse({
    7: '        <VaButton class="h-2" size="small" preset="primary" @click="exportAsCSV">Export</VaButton>',
    14: '          <p class="whitespace-nowrap mt-2">Total earnings</p>',
  }),
  "src/pages/admin/dashboard/Dashboard.vue": sparse({
    2: "import RevenueUpdates from './cards/RevenueReport.vue'",
    16: '      <RevenueUpdates class="w-full sm:w-[70%]" />',
  }),
  "src/layouts/AppLayout.vue": sparse({
    24: "          <RouterView />",
  }),
};

/** An in-memory SourceReader over project-relative paths; `reads` records every path asked for. */
export function memoryReader(files: Record<string, string>): SourceReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(path) {
      reads.push(path);
      return files[path];
    },
  };
}
