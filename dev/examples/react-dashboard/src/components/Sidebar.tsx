import type { Page } from "../App";
import { NAV_ITEMS } from "../data/nav";

interface SidebarProps {
  page: Page;
  onNavigate: (page: Page) => void;
}

/** Sidebar built entirely from data/nav.ts: change the badge count or add an item there, not here. */
export function Sidebar({ page, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-brand">Acme Store</div>
      <ul className="nav-list">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              className={item.page === page ? "nav-item nav-item-active" : "nav-item"}
              onClick={(event) => {
                event.preventDefault();
                if (item.page) onNavigate(item.page);
              }}
            >
              <span>{item.label}</span>
              {item.badge !== undefined && <span className="badge">{item.badge}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
