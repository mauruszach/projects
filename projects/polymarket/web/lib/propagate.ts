/** Shock propagation as covariance-implied same-day co-movement.
 *
 * Given a shock of `deltaLogit` to market A, every other market i gets the
 * implied move beta_iA * deltaLogit, where beta_iA is i's OLS slope on A
 * over the daily history. This is the conditional expectation under a
 * joint-Gaussian view of the two series and uses only the pair (i, A), so
 * indirect paths are never counted twice: a market two hops away in the
 * graph moves by its *own* measured relationship to A, which is usually
 * small. Hop distance (over the currently visible edges) is used only to
 * stage the animation and group the table.
 *
 * The one-day band is the residual standard deviation of i's changes after
 * regressing on A: the spread of what i actually did on days with a given
 * A move. `bigDay` is the empirical analog: what i did on A's largest days.
 */

import type { GraphEdge, GraphNode } from "@/lib/data";
import { betaOn, bigDayResponse, logitChanges, logit, sigmoid, type PriceTable } from "@/lib/pairstats";

export type Impact = {
  node: GraphNode;
  hop: number;
  beta: number;
  rho: number;
  n: number;
  current: number; // latest price
  implied: number; // implied price after the shock
  lo: number; // implied minus one residual sd
  hi: number;
  deltaPoints: number; // implied - current, in probability points
  deltaLogit: number;
  bigDay: { medianSigned: number; sameDir: number; n: number } | null;
  direct: boolean; // shares a visible edge with the shocked market
};

function latest(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}

export function hopDistances(sourceId: string, edges: GraphEdge[], maxHop: number): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  const dist = new Map<string, number>([[sourceId, 0]]);
  let frontier = [sourceId];
  for (let h = 1; h <= maxHop && frontier.length; h++) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, h);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

export function propagate(
  source: GraphNode,
  deltaLogit: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  prices: PriceTable,
  maxHop = 2,
): { impacts: Impact[]; sourceCurrent: number; sourceImplied: number } {
  const dA = logitChanges(prices.series[source.id] ?? []);
  const dist = hopDistances(source.id, edges, maxHop);
  const sourceCurrent = source.current_price ?? latest(prices.series[source.id] ?? []) ?? 0.5;
  const sourceImplied = sigmoid(logit(sourceCurrent) + deltaLogit);
  const impacts: Impact[] = [];
  for (const node of nodes) {
    if (node.id === source.id) continue;
    const hop = dist.get(node.id);
    if (hop === undefined) continue;
    const pb = prices.series[node.id];
    if (!pb) continue;
    const db = logitChanges(pb);
    const fit = betaOn(dA, db);
    const current = node.current_price ?? latest(pb);
    if (!fit || current == null) continue;
    const dl = fit.beta * deltaLogit;
    const base = logit(current);
    impacts.push({
      node,
      hop,
      beta: fit.beta,
      rho: fit.rho,
      n: fit.n,
      current,
      implied: sigmoid(base + dl),
      lo: sigmoid(base + dl - fit.residSd),
      hi: sigmoid(base + dl + fit.residSd),
      deltaPoints: sigmoid(base + dl) - current,
      deltaLogit: dl,
      bigDay: bigDayResponse(dA, db),
      direct: hop === 1,
    });
  }
  impacts.sort((x, y) => Math.abs(y.deltaPoints) - Math.abs(x.deltaPoints));
  return { impacts, sourceCurrent, sourceImplied };
}
