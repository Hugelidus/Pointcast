import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";

export type Page = "dashboard" | "settings";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="content">{page === "dashboard" ? <Dashboard /> : <Settings />}</main>
    </div>
  );
}
