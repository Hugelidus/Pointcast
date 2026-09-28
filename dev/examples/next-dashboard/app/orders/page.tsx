import { OrderFilter } from "@/components/order-filter";
import { Button } from "@/components/ui/button";
import { getOrders } from "@/lib/data";

export default async function OrdersPage() {
  const orders = await getOrders();
  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
        <Button variant="outline">Export CSV</Button>
      </div>
      <OrderFilter />
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.id}</td>
              <td>{order.customer}</td>
              <td>{order.status}</td>
              <td>${order.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
