/** One item of the sidebar (components/Sidebar.tsx). */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Page the sidebar switches to; items without one are illustration only (no page behind them). */
  page?: "dashboard" | "settings";
  /** Unread count shown as a small badge next to the label. */
  badge?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/", page: "dashboard" },
  { id: "orders", label: "Orders", href: "/orders" },
  { id: "customers", label: "Customers", href: "/customers" },
  { id: "messages", label: "Messages", href: "/messages", badge: 3 },
  { id: "settings", label: "Settings", href: "/settings", page: "settings" },
];
