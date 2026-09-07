"use client";

import { useId, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DIM, SERIES } from "@/lib/palette";

export type SeriesDef = { key: string; label: string; dim?: boolean };
export type Row = { x: string | number } & Record<string, number | string | null>;
export type Band = { x1: string | number; x2: string | number };

type Props = {
  title: string;
  subtitle?: string;
  rows: Row[];
  series: SeriesDef[];
  shocks?: { x: string | number; label?: string }[];
  bands?: Band[];
  yLabel?: string;
  height?: number;
  /** fixed decimals for axis, tooltip and table; default adapts to magnitude */
  decimals?: number;
  xTickEvery?: number;
  /** fixed y range, e.g. [-1, 1] for correlations */
  yDomain?: [number, number];
  /** when set, the title renders as an external link */
  titleHref?: string;
};

const fmtDefault = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toPrecision(2);
};

function TooltipBody({
  active,
  payload,
  label,
  series,
  format,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string | null; stroke?: string }[];
  label?: string | number;
  series: SeriesDef[];
  format: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p]));
  return (
    <div className="card px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 text-muted">{String(label)}</div>
      {series.map((s, i) => {
        const p = byKey.get(s.key);
        const v = p?.value;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ background: s.dim ? DIM : SERIES[i % SERIES.length] }}
            />
            <span className="tnum font-semibold text-ink">
              {typeof v === "number" ? format(v) : "–"}
            </span>
            <span className="text-ink-2">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TimeSeriesChart({
  title,
  subtitle,
  rows,
  series,
  shocks = [],
  bands = [],
  yLabel,
  height = 280,
  decimals,
  xTickEvery,
  yDomain,
  titleHref,
}: Props) {
  const format = decimals === undefined ? fmtDefault : (v: number) => v.toFixed(decimals);
  const [table, setTable] = useState(false);
  const id = useId();

  return (
    <figure className="card p-4">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <figcaption className="text-sm font-semibold">
            {titleHref ? (
              <a href={titleHref} target="_blank" rel="noreferrer" className="underline decoration-[var(--axis)] underline-offset-2 hover:decoration-[var(--ink)]">
                {title} ↗
              </a>
            ) : (
              title
            )}
          </figcaption>
          {subtitle && <div className="text-xs text-ink-2">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs text-ink-2 hover:text-ink"
          aria-pressed={table}
          aria-controls={id}
        >
          {table ? "Chart" : "Table"}
        </button>
      </div>

      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-4"
                style={{ background: s.dim ? DIM : SERIES[i % SERIES.length] }}
              />
              {s.label}
            </li>
          ))}
          {shocks.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-px bg-[var(--ink-2)]" />
              shock date
            </li>
          )}
          {bands.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-3" style={{ background: "var(--flag)" }} />
              flagged window
            </li>
          )}
        </ul>
      )}

      {table ? (
        <div id={id} className="max-h-96 overflow-auto text-xs">
          <table className="tnum w-full">
            <thead className="sticky top-0 bg-[var(--surface)] text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">x</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.x)} className="border-t border-[var(--grid)]">
                  <td className="py-0.5 pr-3">{String(r.x)}</td>
                  {series.map((s) => {
                    const v = r[s.key];
                    return (
                      <td key={s.key} className="py-0.5 pr-3">
                        {typeof v === "number" ? format(v) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={id} style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 36, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              {bands.map((b, i) => (
                <ReferenceArea
                  key={i}
                  x1={b.x1}
                  x2={b.x2}
                  fill="var(--flag)"
                  stroke="none"
                  ifOverflow="hidden"
                />
              ))}
              <XAxis
                dataKey="x"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={{ stroke: "var(--axis)" }}
                tickLine={false}
                interval={xTickEvery ? xTickEvery - 1 : "preserveStartEnd"}
                minTickGap={56}
              />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
                domain={yDomain ?? ["auto", "auto"]}
                tickFormatter={format}
                label={
                  yLabel
                    ? { value: yLabel, angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 11 }
                    : undefined
                }
              />
              <Tooltip
                cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
                content={<TooltipBody series={series} format={format} />}
              />
              {shocks.map((s, i) => (
                <ReferenceLine
                  key={i}
                  x={s.x}
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                  ifOverflow="hidden"
                />
              ))}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.dim ? DIM : SERIES[i % SERIES.length]}
                  strokeWidth={s.dim ? 1.5 : 2}
                  dot={false}
                  activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
