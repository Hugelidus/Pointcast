"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const SERIES = {
  weekly: [12, 18, 9, 22, 17, 25, 30],
  monthly: [80, 95, 70, 120],
};

/** Client Component: Radix Tabs plus local state. */
export function RevenueTabs() {
  const [refreshed, setRefreshed] = useState(0);
  return (
    <Tabs.Root defaultValue="weekly" className="tabs">
      <Tabs.List className="tabs-list" aria-label="Revenue period">
        <Tabs.Trigger value="weekly" className="tabs-trigger">
          This week
        </Tabs.Trigger>
        <Tabs.Trigger value="monthly" className="tabs-trigger">
          This month
        </Tabs.Trigger>
      </Tabs.List>
      {Object.entries(SERIES).map(([period, points]) => (
        <Tabs.Content key={period} value={period} className="tabs-content">
          <div className="bars">
            {points.map((p, i) => (
              <span key={i} className="bar" style={{ height: `${p * 3}px` }} />
            ))}
          </div>
        </Tabs.Content>
      ))}
      <div className="tabs-footer">
        <span className="muted">Refreshed {refreshed} times</span>
        <Button variant="outline" onClick={() => setRefreshed((n) => n + 1)}>
          Refresh chart
        </Button>
      </div>
    </Tabs.Root>
  );
}
