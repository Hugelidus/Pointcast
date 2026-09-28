import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Acme Ops",
  description: "A small Next.js dashboard for recording pointcast sessions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main className="content">
            <header className="topbar">
              <span className="muted">Workspace</span>
              <strong>Acme Store EU</strong>
            </header>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
