interface Order {
  id: string;
  customer: string;
  total: string;
  status: "Paid" | "Pending" | "Refunded";
}

const ORDERS: Order[] = [
  { id: "A-1042", customer: "Lina Torres", total: "$128.00", status: "Paid" },
  { id: "A-1041", customer: "Marco Peña", total: "$64.50", status: "Pending" },
  { id: "A-1040", customer: "Sofía Ibarra", total: "$212.00", status: "Paid" },
  { id: "A-1039", customer: "Diego Farfán", total: "$39.90", status: "Refunded" },
];

/** Orders table with its own "Export" button; compare with CustomersPanel's (SCENARIOS.md, scenario 3). */
export function OrdersTable() {
  return (
    <section className="panel">
      <div className="panel-toolbar">
        <h2>Orders</h2>
        <button type="button" id="orders-export" className="btn btn-export">
          Export
        </button>
      </div>
      <table className="data-table" id="orders-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ORDERS.map((order) => (
            <tr key={order.id}>
              <td>{order.id}</td>
              <td>{order.customer}</td>
              <td>{order.total}</td>
              <td>{order.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
