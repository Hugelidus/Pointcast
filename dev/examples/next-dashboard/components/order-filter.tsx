"use client";

import { useState } from "react";

const STATUSES = ["All", "Paid", "Pending", "Refunded"] as const;

/** Client Component: a status filter with local state (it does not filter the server list). */
export function OrderFilter() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  return (
    <div className="filter" role="group" aria-label="Filter orders">
      {STATUSES.map((s) => (
        <button key={s} type="button" className={s === status ? "chip active" : "chip"} onClick={() => setStatus(s)}>
          {s}
        </button>
      ))}
      <span className="muted">Showing: {status.toLowerCase()} orders</span>
    </div>
  );
}
