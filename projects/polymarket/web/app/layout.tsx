import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polymarket Cross-Market Correlation Graph and Shock Simulator",
  description:
    "The live Polymarket universe as a correlation network, with neighborhood charts and a covariance-implied shock simulator.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="app-header">
          <div className="app-header-inner">
            <Link href="/" className="app-brand">
              Polymarket Cross-Market Correlation Graph and Shock Simulator
            </Link>
            <nav className="app-nav">
              <a href="/" className="hover:text-ink">All projects</a>
              <Link href="/" className="hover:text-ink">Graph</Link>
              <Link href="/how-it-works" className="hover:text-ink">How it works</Link>
            </nav>
          </div>
        </header>
        <main className="app-main">{children}</main>
        <footer className="app-footer">
          Built from the correlation screen. Regenerate with{" "}
          <code className="font-mono">scripts/find_correlated_markets.py</code> then{" "}
          <code className="font-mono">scripts/export_web_data.py</code>.
        </footer>
      </body>
    </html>
  );
}
