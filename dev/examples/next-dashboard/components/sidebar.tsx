import { NAV_ITEMS } from "@/lib/nav";
import { NavLink } from "./nav-link";

/** Server Component: the sidebar shell, with one client NavLink per item. */
export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">Acme Ops</div>
      <nav>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} badge={item.badge}>
                {item.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <p className="sidebar-footer">Signed in as ops@acme.test</p>
    </aside>
  );
}
