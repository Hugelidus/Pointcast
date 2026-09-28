export interface NavItem {
  title: string;
  href: string;
  badge?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Overview", href: "/" },
  {
    title: "Orders",
    href: "/orders",
    badge: "12",
  },
  { title: "Settings", href: "/settings" },
];
