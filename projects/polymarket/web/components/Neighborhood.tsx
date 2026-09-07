"use client";

import { useMemo } from "react";
import TimeSeriesChart, { type Row } from "@/components/TimeSeriesChart";
import type { GraphEdge, GraphNode } from "@/lib/data";
import { polymarketUrl } from "@/lib/links";
import { coMoveShare, crossCorr, logitChanges, rollingCorr, spearman, type PriceTable } from "@/lib/pairstats";

const RELATION_LABEL: Record<string, string> = {
  same_event: "same event",
  shared_tag: "shared tag",
  non_obvious: "non-obvious",
};

const fmt = (v: number | null, d = 2) => (v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(d));

function priceRows(dates: string[], a: (number | null)[], b?: (number | null)[]): Row[] {
  return dates.map((d, i) => {
    const r: Row = { x: d, a: a[i] };
    if (b) r.b = b[i];
    return r;
  });
}

export default function Neighborhood({
  selected,
  connections,
  prices,
  loading,
}: {
  selected: GraphNode;
  connections: { e: GraphEdge; other: GraphNode }[];
  prices: PriceTable | null;
  loading: boolean;
}) {
  const cards = useMemo(() => {
    if (!prices) return [];
    const pa = prices.series[selected.id];
    if (!pa) return [];
    const da = logitChanges(pa);
    return connections.map(({ e, other }) => {
      const pb = prices.series[other.id] ?? [];
      const db = logitChanges(pb);
      const sp = spearman(da, db);
      const roll = rollingCorr(da, db, 60);
      const lagAB = crossCorr(da, db, 1); // A today vs B tomorrow
      const lagBA = crossCorr(db, da, 1); // B today vs A tomorrow
      const co = coMoveShare(da, db);
      const shared = other.tags.filter((t) => selected.tags.includes(t));
      return { e, other, pb, sp, roll, lagAB, lagBA, co, shared };
    });
  }, [prices, selected, connections]);

  if (loading) return <div className="card p-4 text-sm text-ink-2">Loading price histories…</div>;
  if (!prices) return null;
  const pa = prices.series[selected.id];
  if (!pa) return <div className="card p-4 text-sm text-ink-2">No price history for this market.</div>;

  return (
    <section className="space-y-4">
      <div className="max-w-3xl">
        <h2 className="text-lg font-semibold">Neighborhood of “{selected.question}”</h2>
        <p className="mt-1 text-xs text-ink-2">
          Prices are daily closes over the screen&apos;s {prices.dates.length}-day window. Each card overlays the
          selected market (blue) with one connected market (orange) and shows their rolling 60-day
          correlation of log-odds changes. Statistics are descriptive summaries of the same daily history the
          screen used; only r, n and q come from the screen&apos;s corrected test. Lag correlations are the
          correlation between one market&apos;s move today and the other&apos;s move tomorrow, which at
          daily resolution is dominated by quote reversal, so read them as description, not prediction.
        </p>
      </div>

      <p className="text-sm leading-relaxed text-ink-2">
        Start with the price chart: 0.50 means 50% implied probability. In the paired charts, blue is your
        selected market and orange is its neighbor. Then look at the rolling correlation: above zero
        means their daily moves tended to align over the preceding 60 days, below zero means they
        tended to oppose, and crossing zero suggests the relationship changed. Gaps indicate missing data.
        A strong full-period number can hide a relationship that weakened recently.
      </p>
      <TimeSeriesChart
        title={selected.question}
        titleHref={polymarketUrl(selected)}
        subtitle={`${selected.event_title} · ${selected.group} · median price ${selected.median_price.toFixed(2)}`}
        rows={priceRows(prices.dates, pa)}
        series={[{ key: "a", label: "implied probability" }]}
        height={200}
        decimals={2}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        {cards.map(({ e, other, pb, sp, roll, lagAB, lagBA, co, shared }) => (
          <div key={other.id} className="card space-y-2 p-3">
            <div>
              <a
                href={polymarketUrl(other)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold underline decoration-[var(--axis)] underline-offset-2 hover:decoration-[var(--ink)]"
              >
                {other.question} ↗
              </a>
              <div className="text-xs text-ink-2">
                {other.event_title} · {other.group}
                {shared.length ? ` · shared tags: ${shared.slice(0, 5).join(", ")}` : ""}
              </div>
            </div>
            <dl className="tnum grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:grid-cols-6">
              <div>
                <dt className="text-muted">Spearman r</dt>
                <dd className="font-semibold" style={{ color: e.r < 0 ? "var(--s8)" : undefined }}>{fmt(e.r)}</dd>
              </div>
              <div>
                <dt className="text-muted">common days</dt>
                <dd>{e.n}</dd>
              </div>
              <div>
                <dt className="text-muted">q (BH)</dt>
                <dd>{e.q < 1e-4 ? "<1e-4" : e.q.toFixed(3)}{e.robust ? " · robust" : e.q <= 0.05 ? " · sig" : ""}</dd>
              </div>
              <div>
                <dt className="text-muted">relation</dt>
                <dd>{RELATION_LABEL[e.relation]}</dd>
              </div>
              <div>
                <dt className="text-muted">same-direction days</dt>
                <dd>{co.share == null ? "–" : `${(co.share * 100).toFixed(0)}% of ${co.n}`}</dd>
              </div>
              <div>
                <dt className="text-muted">lag ±1</dt>
                <dd title="this → other next day / other → this next day">
                  {fmt(lagAB)} / {fmt(lagBA)}
                </dd>
              </div>
            </dl>
            {sp.r != null && Math.abs(sp.r - e.r) > 0.05 && (
              <div className="text-[11px] text-muted">
                Recomputed here on {sp.n} days: {fmt(sp.r)} (the screen&apos;s value uses its own overlap rule).
              </div>
            )}
            <TimeSeriesChart
              title="Prices"
              rows={priceRows(prices.dates, pa, pb)}
              series={[
                { key: "a", label: "selected" },
                { key: "b", label: "connected" },
              ]}
              height={170}
              decimals={2}
            />
            <TimeSeriesChart
              title="Rolling 60-day correlation of daily log-odds changes"
              rows={prices.dates.map((d, i) => ({ x: d, c: roll[i] }))}
              series={[{ key: "c", label: "rolling r" }]}
              height={120}
              decimals={2}
              yDomain={[-1, 1]}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
