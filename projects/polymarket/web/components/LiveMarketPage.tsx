"use client";

import MarketGraph from "@/components/MarketGraph";
import { useEffect, useState } from "react";
import type { Graph } from "@/lib/data";
import type { PriceTable } from "@/lib/pairstats";
import type { RefreshJob } from "@/lib/live-refresh";

export default function LiveMarketPage({ initialGraph }: { initialGraph: Graph }) {
  const [graph, setGraph] = useState(initialGraph);
  const [prices, setPrices] = useState<PriceTable | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"running" | "ready" | "error">("running");
  const [message, setMessage] = useState("Requesting fresh Polymarket data…");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const options = { cache: "no-store" as const, signal: controller.signal };
    async function check(response: Response): Promise<RefreshJob> {
      if (!response.ok) throw new Error("Refresh request failed");
      return response.json();
    }
    function receive(job: RefreshJob) {
      if (controller.signal.aborted) return;
      setMessage(job.message);
      if (job.status === "ready" && job.snapshot) {
        setGraph(job.snapshot.graph);
        setPrices(job.snapshot.prices);
        setStatus("ready");
      } else if (job.status === "error") {
        setStatus("error");
      } else {
        timer = setTimeout(() => {
          void fetch(`/polymarket/api/refresh?id=${encodeURIComponent(job.id)}`, options)
            .then(check).then(receive).catch(failed);
        }, 3000);
      }
    }
    function failed() {
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage("Fresh data could not be loaded. You are viewing the previous snapshot. Please retry.");
    }
    void fetch("/polymarket/api/refresh", { ...options, method: "POST" }).then(check).then(receive).catch(failed);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt]);
  const robust = graph.edges.filter((e) => e.robust).length;
  const sig = graph.edges.filter((e) => e.q <= 0.05).length;
  return (
    <div className="space-y-5">
      <section className="card p-4 space-y-2" aria-label="Data freshness">
        <p role="status" className="font-semibold">{message}</p>
        <p className="text-xs text-ink-2">
          {status === "ready" ? "Refresh complete. " : "Showing the previous snapshot while fresh data is requested. "}
          Displayed snapshot: {graph.generated}.
          {graph.fetch_started_at && ` Collection started: ${graph.fetch_started_at}.`}
          {status === "running" && " A full historical refresh can take several minutes. Simultaneous visitors share the active refresh."}
          {" "}Prices are collected over this interval, not at one instant or streamed continuously.
        </p>
        {status !== "running" && <button type="button" className="primary-button rounded px-3 py-1 text-xs"
          onClick={() => { setStatus("running"); setMessage("Requesting fresh Polymarket data…"); setAttempt((n) => n + 1); }}>
          {status === "error" ? "Retry refresh" : "Refresh again"}
        </button>}
      </section>
      <section className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Market graph</h1>
        <p className="text-sm leading-relaxed text-ink-2">
          Explore which market probabilities have tended to move together, then try a hypothetical
          change in one market to see the moves implied by its historical relationships.
          A price of 0.60 is displayed as 60% implied probability. Connections compare daily changes,
          not whether two markets have similar prices.
        </p>
      </section>
      <section aria-label="Getting started" className="card p-4 space-y-3">
        <h2 className="text-base font-semibold">Your first exploration</h2>
        <ol className="grid gap-4 md:grid-cols-3 text-sm text-ink-2">
          <li><strong className="block text-ink">1. Find a market</strong>Search to highlight a question, or explore the colored dots. Turn on “significant &amp; robust only” for a smaller set of more persistent connections.</li>
          <li><strong className="block text-ink">2. Follow its connections</strong>Click a dot. Gray lines indicate moves in the same direction; red lines indicate opposite moves. Stronger connections are thicker. Scroll down to compare daily price charts.</li>
          <li><strong className="block text-ink">3. Try a what-if</strong>In the simulator below the graph, choose a target probability and click “Run shock.” Compare the implied moves with the uncertainty bands, then try a different target.</li>
        </ol>
        <p className="text-xs text-ink-2">This is a historical co-movement tool: a link does not establish cause and effect, and a simulated move is not a prediction of what happens next. Each visit requests fresh market data and historical analysis. The status above shows whether you are viewing the previous snapshot or the completed refresh.</p>
      </section>
      <details className="first-use text-xs text-ink-2">
        <summary>About this data snapshot · {graph.generated}</summary>
        <p className="mt-2">{graph.nodes.length} markets have usable daily history. The dataset contains {graph.edges.length} connections (|r| ≥ 0.15 or statistically significant); {sig} pass the test adjusted across all pairs, and {robust} remain significant after removing each pair’s three most influential days. The controls below determine which of these connections are visible.</p>
      </details>
      <MarketGraph key={graph.generated} graph={graph} initialPrices={prices} />
    </div>
  );
}
