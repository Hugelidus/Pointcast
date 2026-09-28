# Next.js example: what pointcast should say

A small **Next.js 16 App Router** dashboard (React 19, Turbopack dev) for checking pointcast's code pointer on the stack most early users run. It mixes:

- **Server Components**: the root layout, the sidebar shell, the three pages, the shared `StatCard`, the shadcn-style `Button` and `Card` (used from Server Components), and lists rendered on the server from `lib/data.ts`;
- **Client Components** (`"use client"`): `NavLink` (reads the route), `RevenueTabs` (Radix Tabs plus state), `OrderFilter` and `SettingsForm` (state);
- data modules: `lib/nav.ts` (the sidebar items, imported by the Server Component `Sidebar`) and `lib/data.ts` (stats and orders, read on the server).

The project root is this folder, with the default `create-next-app` layout: no `src/`, and `@/*` mapped to `./*` in `tsconfig.json`.

## Run it

Not a workspace package, so the repository's install and CI never download Next.js:

```sh
cd dev/examples/next-dashboard
pnpm install --ignore-workspace
pnpm dev            # http://127.0.0.1:5548
```

Remove `.next/` and `node_modules/` when done: together they take about 400 MB.

## Ground truth

Written before any recording (2026-09-28). One row per element pointed at. "Used at" is the innermost place the element or its component instance is written; "text/data at" is where its visible text is written, when it is a literal; "chain" is the component chain from the inside out. A dash means silence is the right answer: the text is computed, so no line holds it.

| # | Route | Element | Kind | Used at | Text / data at | Chain |
|---|---|---|---|---|---|---|
| 1 | `/` | «Acme Ops» brand (`.brand`) | server | `<div>` `components/sidebar.tsx:8` | text `components/sidebar.tsx:8` (the metadata title in `app/layout.tsx:6` is not on screen) | `sidebar.tsx:8` ← `<Sidebar>` `app/layout.tsx:15` |
| 2 | `/` | «Acme Store EU» in the top bar | server (root layout) | `<strong>` `app/layout.tsx:19` | text `app/layout.tsx:19` | `app/layout.tsx:19` |
| 3 | `/` | the «Orders 12» sidebar link | client in server | `<Link>` `components/nav-link.tsx:11`, `<NavLink>` `components/sidebar.tsx:13` | data `lib/nav.ts:10` | `nav-link.tsx:11` ← `sidebar.tsx:13` ← `app/layout.tsx:15` |
| 4 | `/` | the «12» badge of Orders | client, short value | `<span>` `components/nav-link.tsx:13` | data `lib/nav.ts:12` | `nav-link.tsx:13` ← `<NavLink>` `sidebar.tsx:13` ← `<Sidebar>` `app/layout.tsx:15` |
| 5 | `/` | «Overview» heading (`h1`) | server page (also a nav item title) | `<h1>` `app/page.tsx:10` | text `app/page.tsx:10` | `app/page.tsx:10` |
| 6 | `/` | «Revenue» card title | server, shared card, data | `<CardTitle>` `components/stat-card.tsx:8`, `<StatCard>` `app/page.tsx:14` | data `lib/data.ts:17` | `stat-card.tsx:8` ← `app/page.tsx:14` |
| 7 | `/` | «$48,210» card value | server, computed | `<div>` `components/stat-card.tsx:10` | — (formatted from `48210`) | `stat-card.tsx:10` ← `app/page.tsx:14` |
| 8 | `/` | «This month» tab | client, Radix | `<Tabs.Trigger>` `components/revenue-tabs.tsx:21` | text `components/revenue-tabs.tsx:22` | `revenue-tabs.tsx:21` ← `<RevenueTabs>` `app/page.tsx:19` |
| 9 | `/` | «Refresh chart» button | client, shared Button | `<Button>` `components/revenue-tabs.tsx:36` | text `components/revenue-tabs.tsx:37` | `revenue-tabs.tsx:36` ← `app/page.tsx:19` |
| 10 | `/` | «Jackson Lee» in Recent orders | server list from data | `<span>` `app/page.tsx:26` | data `lib/data.ts:24` | `app/page.tsx:26` |
| 11 | `/orders` | «Export CSV» button | server page, shared Button | `<Button>` `app/orders/page.tsx:11` | text `app/orders/page.tsx:11` | `app/orders/page.tsx:11` |
| 12 | `/orders` | «Showing: all orders» | client, computed | `<span>` `components/order-filter.tsx:17` | — (built from state) | `order-filter.tsx:17` ← `<OrderFilter>` `app/orders/page.tsx:13` |
| 13 | `/settings` | «Email notifications» label | client form | `<label>` `components/settings-form.tsx:18` | text `components/settings-form.tsx:20` | `settings-form.tsx:18` ← `<SettingsForm>` `app/settings/page.tsx:8` |

What pointcast actually says for each is in [docs/eval/nextjs-2026-09-28.md](../../../docs/eval/nextjs-2026-09-28.md).
