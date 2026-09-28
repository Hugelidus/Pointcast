export interface Stat {
  label: string;
  value: number;
  unit: "currency" | "count";
  change: string;
}

export interface Order {
  id: string;
  customer: string;
  email: string;
  total: number;
  status: "Paid" | "Pending" | "Refunded";
}

const STATS: Stat[] = [
  { label: "Revenue", value: 48210, unit: "currency", change: "+12% from last month" },
  { label: "New customers", value: 318, unit: "count", change: "+4% from last month" },
  { label: "Open tickets", value: 27, unit: "count", change: "-8% from last month" },
];

const ORDERS: Order[] = [
  { id: "A-1001", customer: "Olivia Martin", email: "olivia@example.com", total: 1999, status: "Paid" },
  { id: "A-1002", customer: "Jackson Lee", email: "jackson@example.com", total: 39, status: "Refunded" },
  { id: "A-1003", customer: "Isabella Nguyen", email: "isabella@example.com", total: 299, status: "Pending" },
  { id: "A-1004", customer: "William Kim", email: "will@example.com", total: 99, status: "Paid" },
];

/** Stands in for a database query: only ever called from Server Components. */
export async function getStats(): Promise<Stat[]> {
  return STATS;
}

export async function getOrders(): Promise<Order[]> {
  return ORDERS;
}

export function formatValue(value: number, unit: Stat["unit"]): string {
  return unit === "currency" ? `$${value.toLocaleString("en-US")}` : value.toLocaleString("en-US");
}
