"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Graph, GraphEdge, GraphNode } from "@/lib/data";
import { polymarketUrl } from "@/lib/links";
import Neighborhood from "@/components/Neighborhood";
import ShockSimulator, { type ShockResult } from "@/components/ShockSimulator";
import type { PriceTable } from "@/lib/pairstats";

type SimNode = GraphNode & d3.SimulationNodeDatum & { r: number; degree: number };
type SimEdge = { source: SimNode; target: SimNode; edge: GraphEdge };

const GROUP_ORDER = ["politics", "crypto", "sports", "business", "world", "science", "pop-culture", "other"];
const GROUP_SLOT: Record<string, string> = {
  politics: "--s1",
  crypto: "--s2",
  sports: "--s3",
  business: "--s4",
  world: "--s5",
  science: "--s6",
  "pop-culture": "--s7",
  other: "--dim",
};
const RELATIONS: GraphEdge["relation"][] = ["same_event", "shared_tag", "non_obvious"];
const RELATION_LABEL: Record<string, string> = {
  same_event: "same event",
  shared_tag: "shared tag",
  non_obvious: "non-obvious",
};

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmtVol(v: number) {
  return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
}

export default function MarketGraph({ graph, initialPrices }: { graph: Graph; initialPrices?: PriceTable }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const transformRef = useRef(d3.zoomIdentity);
  const hoverRef = useRef<SimNode | null>(null);
  const selectedRef = useRef<SimNode | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const queryRef = useRef("");
  const shockRef = useRef<ShockResult | null>(null);
  const rafRef = useRef<number | null>(null);

  const [minR, setMinR] = useState(0.25);
  const [robustOnly, setRobustOnly] = useState(false);
  const [relations, setRelations] = useState<Set<string>>(new Set(RELATIONS));
  const [groups, setGroups] = useState<Set<string>>(new Set(GROUP_ORDER));
  const [showIsolated, setShowIsolated] = useState(false);
  const [query, setQuery] = useState("");
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [prices, setPrices] = useState<PriceTable | null>(initialPrices ?? null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState(false);

  // price histories load once, on the first selection
  useEffect(() => {
    if (!selected || prices || pricesLoading || pricesError) return;
    setPricesLoading(true);
    fetch("/polymarket/graph-prices.json")
      .then((r) => { if (!r.ok) throw new Error("Price history unavailable"); return r.json(); })
      .then((j: PriceTable) => setPrices(j))
      .catch(() => setPricesError(true))
      .finally(() => setPricesLoading(false));
  }, [selected, prices, pricesLoading, pricesError]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  // Edge subset under current filters
  const activeEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) =>
          Math.abs(e.r) >= minR &&
          (!robustOnly || e.robust) &&
          relations.has(e.relation) &&
          groups.has(nodeById.get(e.a)?.group ?? "other") &&
          groups.has(nodeById.get(e.b)?.group ?? "other"),
      ),
    [graph.edges, minR, robustOnly, relations, groups, nodeById],
  );

  // Build / rebuild the simulation when the filtered set changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const degree = new Map<string, number>();
    for (const e of activeEdges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const volScale = d3.scaleSqrt().domain([2.5e5, d3.max(graph.nodes, (n) => n.volume) ?? 1e7]).range([3.5, 14]);
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const cx = wrap.clientWidth / 2;
    const cy = Math.max(560, Math.min(820, Math.round(wrap.clientWidth * 0.62))) / 2;
    const nodes: SimNode[] = graph.nodes
      .filter((n) => groups.has(n.group) && (showIsolated || (degree.get(n.id) ?? 0) > 0))
      .map((n, i) => {
        const old = prev.get(n.id);
        // new nodes start on a loose ring around the center so the layout
        // never has to travel in from the origin
        const angle = (i * 2.399963) % (Math.PI * 2);
        const rad = 120 + (i % 7) * 25;
        return {
          ...n,
          r: volScale(n.volume),
          degree: degree.get(n.id) ?? 0,
          x: old?.x ?? cx + Math.cos(angle) * rad,
          y: old?.y ?? cy + Math.sin(angle) * rad,
          vx: 0,
          vy: 0,
        };
      });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: SimEdge[] = activeEdges
      .filter((e) => byId.has(e.a) && byId.has(e.b))
      .map((e) => ({ source: byId.get(e.a)!, target: byId.get(e.b)!, edge: e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    setStats({ nodes: nodes.length, edges: edges.length });
    if (selectedRef.current && !byId.has(selectedRef.current.id)) {
      selectedRef.current = null;
      setSelected(null);
    }

    const width = wrap.clientWidth;
    const height = Math.max(560, Math.min(820, Math.round(width * 0.62)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d")!;

    const colors = {
      surface: cssVar("--surface"),
      ink: cssVar("--ink"),
      ink2: cssVar("--ink-2"),
      muted: cssVar("--muted"),
      grid: cssVar("--grid"),
      neg: cssVar("--s8"),
      good: cssVar("--good"),
      group: Object.fromEntries(GROUP_ORDER.map((g) => [g, cssVar(GROUP_SLOT[g])])),
    };

    simRef.current?.stop();
    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((l) => 30 + (1 - Math.abs(l.edge.r)) * 140)
          .strength((l) => 0.2 + Math.abs(l.edge.r) * 0.8),
      )
      .force("charge", d3.forceManyBody<SimNode>().strength((d) => -40 - d.r * 6))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force("collide", d3.forceCollide<SimNode>((d) => d.r + 3))
      .force("x", d3.forceX(width / 2).strength(0.02))
      .force("y", d3.forceY(height / 2).strength(0.02))
      .alpha(1)
      .alphaDecay(0.03);
    simRef.current = sim;

    const draw = () => {
      const q = queryRef.current;
      const t = transformRef.current;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.surface;
      ctx.fillRect(0, 0, width, height);
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const focus = selectedRef.current ?? hoverRef.current;
      const neighbors = new Set<string>();
      if (focus) {
        neighbors.add(focus.id);
        for (const l of edges) {
          if (l.source.id === focus.id) neighbors.add(l.target.id);
          if (l.target.id === focus.id) neighbors.add(l.source.id);
        }
      }

      // edges: width and opacity by |r|, color by sign, faint if not significant
      ctx.lineCap = "round";
      for (const l of edges) {
        const a = Math.abs(l.edge.r);
        const touchesFocus = focus && (l.source.id === focus.id || l.target.id === focus.id);
        const dimmed = focus && !touchesFocus;
        const sig = l.edge.q <= 0.05;
        ctx.strokeStyle = l.edge.r < 0 ? colors.neg : colors.ink2;
        ctx.globalAlpha = dimmed ? 0.04 : (sig ? 0.15 : 0.07) + a * (sig ? 0.6 : 0.25);
        ctx.lineWidth = (0.5 + a * 3.5) / t.k;
        ctx.beginPath();
        ctx.moveTo(l.source.x!, l.source.y!);
        ctx.lineTo(l.target.x!, l.target.y!);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of nodes) {
        const matches = q && (n.question.toLowerCase().includes(q) || n.event_title?.toLowerCase().includes(q));
        const dimmed = (focus && !neighbors.has(n.id)) || (q && !matches);
        ctx.globalAlpha = dimmed ? 0.15 : 1;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fillStyle = colors.group[n.group] ?? colors.muted;
        ctx.fill();
        ctx.lineWidth = 2 / t.k;
        ctx.strokeStyle = colors.surface;
        ctx.stroke();
        if (focus && n.id === focus.id) {
          ctx.lineWidth = 2 / t.k;
          ctx.strokeStyle = colors.ink;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 3 / t.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // shock overlay: halos sized by implied move, colored by sign, staged
      // by hop with a short expanding ring animation
      const shock = shockRef.current;
      if (shock) {
        const elapsed = (performance.now() - shock.startedAt) / 1000;
        const up = colors.good;
        const down = colors.neg;
        const src = nodes.find((n) => n.id === shock.sourceId);
        if (src) {
          const ring = Math.min(1, elapsed / 0.6);
          ctx.beginPath();
          ctx.arc(src.x!, src.y!, src.r + 4 / t.k + ring * 18 / t.k, 0, Math.PI * 2);
          ctx.strokeStyle = shock.deltaLogit >= 0 ? up : down;
          ctx.globalAlpha = 0.9 * (1 - ring * 0.6);
          ctx.lineWidth = 2 / t.k;
          ctx.stroke();
        }
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const maxAbs = Math.max(0.01, ...shock.impacts.map((i) => Math.abs(i.deltaPoints)));
        for (const imp of shock.impacts) {
          if (Math.abs(imp.rho) < 0.1 || Math.abs(imp.deltaPoints) < 0.005) continue; // not meaningfully related
          const n = byId.get(imp.node.id);
          if (!n) continue;
          const start = 0.5 * imp.hop; // seconds
          if (elapsed < start) continue;
          const prog = Math.min(1, (elapsed - start) / 0.6);
          const mag = Math.abs(imp.deltaPoints) / maxAbs;
          const halo = (4 + mag * 22) / t.k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + halo * prog, 0, Math.PI * 2);
          ctx.fillStyle = imp.deltaPoints >= 0 ? up : down;
          ctx.globalAlpha = 0.12 + 0.35 * mag;
          ctx.fill();
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1.5 / t.k;
          ctx.strokeStyle = imp.deltaPoints >= 0 ? up : down;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // labels: selective. Neighborhood when focused; top-degree nodes otherwise; search matches always.
      ctx.font = `${11 / t.k}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = colors.ink;
      ctx.textBaseline = "middle";
      const shockLabels = new Map<string, string>();
      if (shock) {
        for (const imp of shock.impacts.filter((i) => Math.abs(i.rho) >= 0.1 && Math.abs(i.deltaPoints) >= 0.005).slice(0, 25)) {
          shockLabels.set(
            imp.node.id,
            `${imp.deltaPoints >= 0 ? "+" : "−"}${Math.abs(imp.deltaPoints * 100).toFixed(1)}`,
          );
        }
      }
      const labelled = shock
        ? nodes.filter((n) => shockLabels.has(n.id) || n.id === shock.sourceId)
        : focus
        ? nodes.filter((n) => neighbors.has(n.id))
        : q
          ? nodes.filter((n) => n.question.toLowerCase().includes(q) || n.event_title?.toLowerCase().includes(q))
          : [...nodes].sort((a, b) => b.degree - a.degree).slice(0, t.k > 1.8 ? 60 : 14);
      for (const n of labelled) {
        const short = n.question.length > 48 ? n.question.slice(0, 46) + "…" : n.question;
        const text = shock && shockLabels.has(n.id) ? `${shockLabels.get(n.id)}  ${short}` : short;
        const x = n.x! + n.r + 4 / t.k;
        const y = n.y!;
        const w = ctx.measureText(text).width;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = colors.surface;
        ctx.fillRect(x - 2 / t.k, y - 7 / t.k, w + 4 / t.k, 14 / t.k);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.ink;
        ctx.fillText(text, x, y);
      }
      ctx.restore();
    };
    drawRef.current = draw;
    sim.on("tick", draw);

    // interaction: zoom/pan, hover, click, drag
    const canvasSel = d3.select(canvas);
    const pick = (mx: number, my: number): SimNode | null => {
      const t = transformRef.current;
      const [x, y] = t.invert([mx, my]);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - x, n.y! - y);
        const hit = Math.max(n.r + 4, 12 / t.k);
        if (d < hit && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.3, 8])
      .filter((ev) => !ev.button && (ev.type !== "mousedown" || !pick(ev.offsetX, ev.offsetY)))
      .on("zoom", (ev) => {
        transformRef.current = ev.transform;
        draw();
      });
    canvasSel.call(zoom);
    canvasSel.call(zoom.transform, transformRef.current);

    const drag = d3
      .drag<HTMLCanvasElement, unknown>()
      .subject((ev) => pick(ev.x, ev.y) as unknown as d3.SubjectPosition)
      .on("start", (ev) => {
        if (!ev.active) sim.alphaTarget(0.3).restart();
        const n = ev.subject as SimNode;
        n.fx = n.x;
        n.fy = n.y;
      })
      .on("drag", (ev) => {
        const t = transformRef.current;
        const [x, y] = t.invert([ev.x, ev.y]);
        const n = ev.subject as SimNode;
        n.fx = x;
        n.fy = y;
      })
      .on("end", (ev) => {
        if (!ev.active) sim.alphaTarget(0);
        const n = ev.subject as SimNode;
        n.fx = null;
        n.fy = null;
      });
    canvasSel.call(drag);

    const onMove = (ev: MouseEvent) => {
      const n = pick(ev.offsetX, ev.offsetY);
      if (n !== hoverRef.current) {
        hoverRef.current = n;
        setHover(n ? { node: n, x: ev.offsetX, y: ev.offsetY } : null);
        draw();
      } else if (n) {
        setHover({ node: n, x: ev.offsetX, y: ev.offsetY });
      }
      canvas.style.cursor = n ? "pointer" : "grab";
    };
    const onLeave = () => {
      hoverRef.current = null;
      setHover(null);
      draw();
    };
    const onClick = (ev: MouseEvent) => {
      const n = pick(ev.offsetX, ev.offsetY);
      selectedRef.current = n && selectedRef.current?.id === n.id ? null : n;
      setSelected(selectedRef.current);
      shockRef.current = null;
      draw();
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);
    return () => {
      sim.stop();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvasSel.on(".zoom", null).on(".drag", null);
    };
  }, [activeEdges, graph.nodes, groups, showIsolated]);

  // search only repaints; it never re-runs the layout
  useEffect(() => {
    queryRef.current = query.trim().toLowerCase();
    drawRef.current();
  }, [query]);

  // theme changes repaint
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => drawRef.current();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const onShock = useCallback((r: ShockResult | null) => {
    shockRef.current = r;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      drawRef.current();
      if (shockRef.current && performance.now() - shockRef.current.startedAt < 3000) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    tick();
  }, []);

  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  const selectedEdges = useMemo(() => {
    if (!selected) return [];
    return activeEdges
      .filter((e) => e.a === selected.id || e.b === selected.id)
      .map((e) => ({ e, other: nodeById.get(e.a === selected.id ? e.b : e.a)! }))
      .sort((x, y) => Math.abs(y.e.r) - Math.abs(x.e.r));
  }, [selected, activeEdges, nodeById]);

  const tableRows = useMemo(
    () => [...activeEdges].sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 500),
    [activeEdges],
  );

  return (
    <div className="space-y-3">
      <div className="card graph-controls flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Minimum correlation |r|</span>
          <input
            type="range"
            min={0.15}
            max={0.8}
            step={0.05}
            value={minR}
            onChange={(e) => setMinR(parseFloat(e.target.value))}
            className="w-32"
          />
          <span className="tnum w-8 font-semibold">{minR.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={robustOnly} onChange={(e) => setRobustOnly(e.target.checked)} />
          <span className="text-ink-2">significant &amp; robust only</span>
        </label>
        <span className="flex items-center gap-2">
          <span className="text-ink-2">relation</span>
          {RELATIONS.map((r) => (
            <label key={r} className="flex items-center gap-1">
              <input type="checkbox" checked={relations.has(r)} onChange={() => toggle(relations, r, setRelations)} />
              {RELATION_LABEL[r]}
            </label>
          ))}
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
          <span className="text-ink-2">show unconnected markets</span>
        </label>
        <input
          type="search"
          aria-label="Highlight markets by question"
          placeholder="highlight a question…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--page)] px-2 py-1"
        />
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-ink-2 hover:text-ink"
          aria-pressed={table}
        >
          {table ? "Graph" : "Table"}
        </button>
      </div>

      <details className="card first-use p-4 text-xs text-ink-2">
        <summary>What do the filters and numbers mean?</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <p><strong>Minimum correlation |r|:</strong> raise this to hide weaker connections. The strength runs from 0 to 1; the sign tells you the direction. +0.6 means moves tend to align; −0.6 means they tend to oppose. Neither means a 60% chance of winning.</p>
          <p><strong>Significant &amp; robust only:</strong> keep relationships that pass the statistical check across all tested pairs and still pass after removing their three most influential days. Start here to reduce clutter.</p>
          <p><strong>Relation:</strong> “same event” pairs belong to the same Polymarket event; “shared tag” pairs have a topic tag in common; “non-obvious” pairs have neither. These labels describe metadata, not a proven explanation for a connection.</p>
          <p><strong>Categories and search:</strong> click a category in the legend to hide or show it. Search highlights matching dots without removing other markets. “Show unconnected markets” includes dots with no links under your current filters.</p>
          <p><strong>Table:</strong> compare pairs numerically. r is correlation, n is the number of overlapping daily changes, and q is the adjusted statistical test value (0.05 or less passes). Bold rows pass the robustness check.</p>
          <p><strong>No connections?</strong> lower the minimum correlation or restore categories and relation types. A missing line means the pair is absent under this screen and these filters; it does not prove the markets are unrelated.</p>
        </div>
      </details>

      <ul className="graph-legend flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend and category filter">
        {GROUP_ORDER.map((g) => (
          <li key={g}>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" className="sr-only" checked={groups.has(g)} onChange={() => toggle(groups, g, setGroups)} />
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: `var(${GROUP_SLOT[g]})`, opacity: groups.has(g) ? 1 : 0.25 }}
              />
              <span className={groups.has(g) ? "" : "text-muted line-through"}>{g}</span>
            </label>
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-ink-2">
          <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: "var(--ink-2)" }} /> positive r
        </li>
        <li className="flex items-center gap-1.5 text-ink-2">
          <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: "var(--s8)" }} /> negative r
        </li>
        <li className="tnum text-muted">
          {stats.nodes} markets · {stats.edges} edges shown
        </li>
      </ul>

      {table ? (
        <div className="card max-h-[640px] overflow-auto p-4 text-xs">
          <table className="tnum w-full">
            <thead className="sticky top-0 bg-[var(--surface)] text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">r</th>
                <th className="py-1 pr-3 font-medium">n</th>
                <th className="py-1 pr-3 font-medium">q</th>
                <th className="py-1 pr-3 font-medium">relation</th>
                <th className="py-1 pr-3 font-medium">market A</th>
                <th className="py-1 pr-3 font-medium">market B</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((e) => (
                <tr key={`${e.a}-${e.b}`} className={`border-t border-[var(--grid)] ${e.robust ? "font-semibold" : ""}`}>
                  <td className="py-0.5 pr-3">{(e.r >= 0 ? "+" : "") + e.r.toFixed(2)}</td>
                  <td className="py-0.5 pr-3 font-normal">{e.n}</td>
                  <td className="py-0.5 pr-3 font-normal">{e.q < 1e-4 ? "<1e-4" : e.q.toFixed(3)}</td>
                  <td className="py-0.5 pr-3 font-normal text-ink-2">{RELATION_LABEL[e.relation]}</td>
                  <td className="py-0.5 pr-3 font-normal">{nodeById.get(e.a)?.question}</td>
                  <td className="py-0.5 pr-3 font-normal">{nodeById.get(e.b)?.question}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {activeEdges.length > 500 && <div className="mt-2 text-muted">showing the 500 strongest of {activeEdges.length}</div>}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div ref={wrapRef} className="card relative overflow-hidden">
            <canvas ref={canvasRef} className="block" />
            {hover && !selected && (
              <div
                className="card pointer-events-none absolute z-10 max-w-xs px-3 py-2 text-xs shadow"
                style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 300), top: hover.y + 14 }}
              >
                <div className="font-semibold text-ink">{hover.node.question}</div>
                <div className="mt-1 text-ink-2">{hover.node.event_title}</div>
                <div className="tnum mt-1 text-muted">
                  {hover.node.group} · {fmtVol(hover.node.volume)} · median {hover.node.median_price.toFixed(2)} ·{" "}
                  {hover.node.degree} edge{hover.node.degree === 1 ? "" : "s"}
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted">
              scroll to zoom · drag background to pan · drag a node to move it · click a node to pin its neighborhood
            </div>
          </div>
          <aside className="card graph-inspector p-4 text-xs">
            {selected ? (
              <>
                <a href={polymarketUrl(selected)} target="_blank" rel="noreferrer" className="font-semibold underline decoration-[var(--axis)] underline-offset-2 hover:decoration-[var(--ink)]">
                  {selected.question} ↗
                </a>
                <div className="mt-1 text-ink-2">{selected.event_title}</div>
                <div className="tnum mt-1 text-muted">
                  {selected.group} · {fmtVol(selected.volume)} · median price {selected.median_price.toFixed(2)} ·{" "}
                  {selected.n_days} days
                </div>
                <div className="mt-1 text-muted">{selected.tags.slice(0, 8).join(", ")}</div>
                <p className="mt-3 text-ink-2">Scroll below the graph to run a hypothetical shock and compare this market’s price history with its neighbors.</p>
                <div className="mt-3 mb-1 font-medium text-ink-2">Connections ({selectedEdges.length})</div>
                <ul className="max-h-[520px] space-y-1 overflow-auto">
                  {selectedEdges.map(({ e, other }) => (
                    <li key={other.id} className="border-t border-[var(--grid)] pt-1">
                      <span className="tnum font-semibold" style={{ color: e.r < 0 ? "var(--s8)" : undefined }}>
                        {(e.r >= 0 ? "+" : "") + e.r.toFixed(2)}
                      </span>{" "}
                      <span className="text-muted">{RELATION_LABEL[e.relation]}{e.robust ? " · robust" : e.q <= 0.05 ? " · sig" : ""}</span>
                      <div className="text-ink-2">{other.question}</div>
                    </li>
                  ))}
                </ul>
                <button type="button" className="mt-3 underline text-ink-2" onClick={() => { selectedRef.current = null; setSelected(null); drawRef.current(); }}>
                  clear selection
                </button>
              </>
            ) : (
              <div className="text-ink-2">
                <div className="font-medium text-ink">Click a dot to begin</div>
                <p className="mt-2">Hover to read a market’s question. Click to select it, reveal its connections here, and open the simulator and charts below the graph. Click empty space or clear the selection to start over.</p>
                <p className="mt-2">
                  Each dot is a live market that passed the screen; size is lifetime volume, color is its
                  topic category. Dot size does not indicate probability. Nearby dots are arranged for readability, not on a time or probability axis. Each line is the Spearman correlation of daily log-odds changes over the
                  last {String(graph.params.lookback_days)} days: thicker and darker is stronger, red is negative.
                </p>
                <p className="mt-2">
                  Raise the threshold to see only the strong structure; switch on “significant &amp; robust” to
                  keep only pairs that survive BH correction across all pairs tested and the removal of
                  their three most influential days.
                </p>
                <p className="mt-2 text-muted">
                  {graph.n_screened} markets cleared the metadata screen; {graph.n_long_shots_excluded} were
                  excluded for trading within 5 cents of 0 or 1, where one tick is a large log-odds jump and
                  correlations are artifacts.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
      {selected && pricesError && <div role="alert" className="card p-4 text-sm">
        Price histories could not be loaded. <button className="underline" onClick={() => setPricesError(false)}>Retry loading histories</button>
      </div>}
      {selected && (
        <ShockSimulator
          source={selected}
          nodes={graph.nodes.filter((n) => groups.has(n.group))}
          edges={activeEdges}
          prices={prices}
          onShock={onShock}
        />
      )}
      {selected && (
        <Neighborhood selected={selected} connections={selectedEdges} prices={prices} loading={pricesLoading} />
      )}
    </div>
  );
}
