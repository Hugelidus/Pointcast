interface Customer {
  id: string;
  name: string;
  email: string;
}

const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Lina Torres", email: "lina@example.com" },
  { id: "c2", name: "Marco Peña", email: "marco@example.com" },
  { id: "c3", name: "Sofía Ibarra", email: "sofia@example.com" },
];

/** Customers panel with its own "Export" button; compare with OrdersTable's (SCENARIOS.md, scenario 3). */
export function CustomersPanel() {
  return (
    <section className="panel">
      <div className="panel-toolbar">
        <h2>Customers</h2>
        <button type="button" id="customers-export" className="btn btn-export">
          Export
        </button>
      </div>
      <p className="panel-subtitle">Everyone who has placed an order</p>
      <ul className="customer-list">
        {CUSTOMERS.map((customer) => (
          <li key={customer.id}>
            <span className="customer-name">{customer.name}</span>
            <span className="customer-email">{customer.email}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
