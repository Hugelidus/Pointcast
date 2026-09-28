import { RevenueTabs } from "@/components/revenue-tabs";
import { StatCard } from "@/components/stat-card";
import { getOrders, getStats } from "@/lib/data";

/** Server Component: the data is read on the server and rendered to HTML there. */
export default async function OverviewPage() {
  const [stats, orders] = await Promise.all([getStats(), getOrders()]);
  return (
    <>
      <h1>Overview</h1>
      <p className="lead">Sales and support at a glance, updated every hour.</p>
      <section className="stats">
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </section>
      <section className="panel">
        <h2>Revenue trend</h2>
        <RevenueTabs />
      </section>
      <section className="panel">
        <h2>Recent orders</h2>
        <ul className="orders">
          {orders.map((order) => (
            <li key={order.id}>
              <span className="customer">{order.customer}</span>
              <span className="muted">{order.email}</span>
              <span className="total">${order.total}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
