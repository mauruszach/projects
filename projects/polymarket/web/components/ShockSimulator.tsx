"use client";

import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/data";
import { polymarketUrl } from "@/lib/links";
import { logit, type PriceTable } from "@/lib/pairstats";
import { propagate, type Impact } from "@/lib/propagate";

export type ShockResult = {
  sourceId: string;
  deltaLogit: number;
  impacts: Impact[];
  startedAt: number;
};

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;
const pts = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pts`;
const fmt = (v: number, d = 2) => (v >= 0 ? "+" : "") + v.toFixed(d);

function latest(series: (number | null)[] | undefined): number | null {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}

export default function ShockSimulator({
  source,
  nodes,
  edges,
  prices,
  onShock,
}: {
  source: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  prices: PriceTable | null;
  onShock: (r: ShockResult | null) => void;
}) {
  const current = source.current_price ?? latest(prices?.series[source.id]) ?? source.median_price;
  const [target, setTarget] = useState(Math.min(0.99, current + 0.1));
  const [maxHop, setMaxHop] = useState(2);
  const [result, setResult] = useState<{ impacts: Impact[]; sourceImplied: number } | null>(null);

  // reset when the selected market changes
  useEffect(() => {
    setTarget(Math.min(0.99, Math.max(0.01, current + 0.1)));
    setResult(null);
    onShock(null);
  }, [source.id, current, onShock]);

  const deltaLogit = logit(target) - logit(current);

  const run = () => {
    if (!prices) return;
    const r = propagate(source, deltaLogit, nodes, edges, prices, maxHop);
    setResult({ impacts: r.impacts, sourceImplied: r.sourceImplied });
    onShock({ sourceId: source.id, deltaLogit, impacts: r.impacts, startedAt: performance.now() });
  };

  const byHop = useMemo(() => {
    const m = new Map<number, Impact[]>();
    for (const i of result?.impacts ?? []) {
      if (!m.has(i.hop)) m.set(i.hop, []);
      m.get(i.hop)!.push(i);
    }
    return m;
  }, [result]);

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold">Shock simulator</h2>
          <p className="mt-1 text-xs text-ink-2">
            What if the probability of “{source.question}” changed? Set a hypothetical target below,
            then run the scenario. The model uses each reachable market’s historical relationship
            with this selected market to estimate a same-day move. It does not predict a later reaction.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Target probability</span>
          <input
            type="range"
            min={0.01}
            max={0.99}
            step={0.01}
            value={target}
            onChange={(e) => setTarget(parseFloat(e.target.value))}
            className="w-48"
          />
          <span className="tnum w-36 font-semibold">
            {pct(current)} → {pct(target)}{" "}
            <span className="font-normal text-ink-2">({fmt(deltaLogit)} log-odds)</span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Markets to include</span>
          <select value={maxHop} onChange={(e) => setMaxHop(parseInt(e.target.value))} className="rounded border border-[var(--border)] bg-[var(--page)] px-1 py-0.5">
            <option value={1}>direct connections</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={!prices}
          className="primary-button rounded px-3 py-1 font-semibold disabled:opacity-40"
        >
          Run shock
        </button>
        {result && (
          <button type="button" className="underline text-ink-2" onClick={() => { setResult(null); onShock(null); }}>
            clear
          </button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-2">
        For example, moving from 40% to 50% is a +10 percentage-point shock, not a 10% relative increase.
        “Direct connections” includes immediate neighbors; 2 or 3 hops includes markets reached through
        that many visible links. Filters change which markets are reachable. Each move is calculated
        against the selected market directly; the animation does not represent a causal chain or a time delay.
        After changing a target, reach, or graph filter, click “Run shock” again to refresh the results.
      </p>
      <details className="first-use text-xs text-ink-2">
        <summary>How to read a scenario result</summary>
        <div className="mt-2 space-y-2">
          <p><strong>Now → implied:</strong> the price returned by Polymarket during the refresh (or the latest daily history price when unavailable) and the model’s hypothetical price. “Move” is the difference in percentage points. Prices are collected during the displayed fetch window, not streamed continuously.</p>
          <p><strong>±1 sd band:</strong> the implied price plus or minus one residual standard deviation, converted back from log-odds. It illustrates historical daily variation the selected market did not explain; it is not a guaranteed range.</p>
          <p><strong>β and ρ:</strong> β measures how much a market’s daily log-odds change has varied with the selected market’s change. ρ measures their linear correlation. A positive sign means the same direction; a negative sign means the opposite. This ρ differs from the graph’s rank-based Spearman r.</p>
          <p><strong>On its biggest days:</strong> how often this market moved in the same direction on the selected market’s largest historical moves. The count shows how many observations support that summary. Dimmed rows have a weak direct relationship, even if a path connects them.</p>
        </div>
      </details>

      {result && (
        <div className="space-y-3">
          {[...byHop.keys()].sort().map((hop) => (
            <div key={hop}>
              <div className="mb-1 text-xs font-medium text-ink-2">
                {hop === 1 ? "Direct connections" : `${hop} hops away`} · {byHop.get(hop)!.length} markets
              </div>
              <div className="overflow-x-auto">
                <table className="tnum w-full text-xs">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">market</th>
                      <th className="py-1 pr-3 text-right font-medium">now</th>
                      <th className="py-1 pr-3 text-right font-medium">implied</th>
                      <th className="py-1 pr-3 text-right font-medium">move</th>
                      <th className="py-1 pr-3 text-right font-medium">±1 sd band</th>
                      <th className="py-1 pr-3 text-right font-medium">β</th>
                      <th className="py-1 pr-3 text-right font-medium">ρ</th>
                      <th className="py-1 pr-3 text-right font-medium">on its biggest days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byHop.get(hop)!.map((i) => (
                      <tr
                        key={i.node.id}
                        className={`border-t border-[var(--grid)] ${Math.abs(i.rho) < 0.1 ? "opacity-50" : ""}`}
                        title={Math.abs(i.rho) < 0.1 ? "weak relationship (|ρ| < 0.1): treat the implied move as noise" : undefined}
                      >
                        <td className="py-1 pr-3 font-normal">
                          <a href={polymarketUrl(i.node)} target="_blank" rel="noreferrer" className="underline decoration-[var(--axis)] underline-offset-2 hover:decoration-[var(--ink)]">
                            {i.node.question}
                          </a>
                        </td>
                        <td className="py-1 pr-3 text-right">{pct(i.current)}</td>
                        <td className="py-1 pr-3 text-right font-semibold">{pct(i.implied)}</td>
                        <td className="py-1 pr-3 text-right font-semibold" style={{ color: i.deltaPoints < 0 ? "var(--s8)" : i.deltaPoints > 0 ? "var(--good)" : undefined }}>
                          {pts(i.deltaPoints)}
                        </td>
                        <td className="py-1 pr-3 text-right text-ink-2">
                          {pct(Math.min(i.lo, i.hi))} – {pct(Math.max(i.lo, i.hi))}
                        </td>
                        <td className="py-1 pr-3 text-right">{fmt(i.beta)}</td>
                        <td className="py-1 pr-3 text-right">{fmt(i.rho)}</td>
                        <td className="py-1 pr-3 text-right text-ink-2">
                          {i.bigDay ? `same way ${(i.bigDay.sameDir * 100).toFixed(0)}% of ${i.bigDay.n}` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {result.impacts.length === 0 && <div className="text-xs text-ink-2">No reachable markets under the current filters.</div>}
          <div className="text-[11px] text-muted">
            Dimmed rows have |ρ| &lt; 0.1 with the shocked market: reachable through the graph, but their implied
            move is within noise. Only markets with |ρ| ≥ 0.1 and a move of at least half a point are drawn on the canvas.
          </div>
        </div>
      )}
    </section>
  );
}
