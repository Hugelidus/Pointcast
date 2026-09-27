interface StatCardProps {
  title: string;
  subtitle: string;
  value: string;
  reportHref: string;
}

/**
 * Rendered twice from pages/Dashboard.tsx ("Revenue" and "Orders"): same component, same
 * "View report" link text in both. See SCENARIOS.md, scenario 1.
 */
export function StatCard({ title, subtitle, value, reportHref }: StatCardProps) {
  return (
    <section className="stat-card">
      <h3>{title}</h3>
      <p className="stat-subtitle">{subtitle}</p>
      <p className="stat-value">{value}</p>
      <a className="stat-link" href={reportHref}>
        View report
      </a>
    </section>
  );
}
