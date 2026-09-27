import { HeaderBar } from "../components/HeaderBar";
import { OrdersTable } from "../components/OrdersTable";
import { SalesChart } from "../components/SalesChart";
import { StatCard } from "../components/StatCard";

export function Dashboard() {
  return (
    <div className="page">
      <HeaderBar title="Dashboard" />
      <div className="stat-grid">
        <StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" reportHref="/reports/revenue" />
        <StatCard title="Orders" subtitle="Last 30 days" value="128" reportHref="/reports/orders" />
      </div>
      <SalesChart />
      <OrdersTable />
    </div>
  );
}
