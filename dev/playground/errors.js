// Broken on purpose: see errors.html. Line numbers matter to dev/e2e/page-errors.spec.ts, which
// expects the spec to name errors.js:<line> for the console.error and the TypeError below.
const toast = document.getElementById("toast");
function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1500);
}

async function loadOrders() {
  const response = await fetch("api/orders?status=open&page=1");
  document.getElementById("orders-status").textContent = response.ok ? "Orders loaded" : "Could not load orders";
}

async function exportOrders() {
  const response = await fetch("api/export", { method: "POST", body: JSON.stringify({ format: "csv" }) });
  if (!response.ok) console.error(`Export failed: ${response.status}`);
}

function archiveOrders() {
  const selection = undefined;
  return selection.rows.length;
}

loadOrders();
document.getElementById("broken-export").addEventListener("click", exportOrders);
document.getElementById("broken-archive").addEventListener("click", archiveOrders);
document.getElementById("working-refresh").addEventListener("click", () => notify("Refreshed"));
