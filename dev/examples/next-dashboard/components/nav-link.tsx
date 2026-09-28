"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Client Component: highlights the current route. */
export function NavLink({ href, badge, children }: { href: string; badge?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link href={href} className={active ? "nav-link active" : "nav-link"}>
      <span>{children}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </Link>
  );
}
