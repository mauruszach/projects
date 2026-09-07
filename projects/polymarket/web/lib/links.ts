/** Browser-safe helpers (no Node imports; client components import from here). */

/** Public Polymarket page for a market; falls back to the event page. */
export function polymarketUrl(n: { event_slug: string; market_slug?: string | null }): string {
  const base = `https://polymarket.com/event/${n.event_slug}`;
  return n.market_slug ? `${base}/${n.market_slug}` : base;
}
