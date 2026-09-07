import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Temporal Knowledge Graph Engine for Geopolitical Event Forecasting", description: "Explore the relationships behind reported world events." };
export default function Layout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
