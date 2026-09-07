"""Find non-obviously correlated Polymarket markets.

    .venv/bin/python scripts/find_correlated_markets.py [--max-events 1500] [--lookback 240]
        [--min-overlap 60] [--min-active-frac 0.25] [--top 40] [--refresh]

Pipeline
  1. Universe: live events by volume from Gamma, flattened to markets that
     clear a metadata screen (volume, liquidity, age), with event tags.
  2. Daily Yes-price history per market from the CLOB; daily log-odds
     changes; markets kept only if they have enough days and enough days
     on which the price actually moved (stale series are dropped, not
     zero-filled).
  3. Pairwise Pearson correlation of changes over each pair's common days
     (min overlap). p-values from a Fisher z test are BH-corrected across
     every pair tested, so "significant" survives the size of the search.
  4. Each pair is labelled by how obvious it is:
        same_event   same Gamma event (mutually exclusive outcomes are
                     mechanically correlated)
        shared_tag   different events sharing a specific tag
        non_obvious  different events, no shared specific tag
     and additionally by whether the questions share a proper-noun token
     (a weak "same entity" hint that tags may miss).
  5. A one-factor check: the first principal component of the change
     matrix (on the fully-overlapping core) and residual correlations after
     removing it, so pairs that co-move only through a market-wide factor
     are separated from pairs with a specific link.

Writes results/correlated_markets.json and .md. This is a discovery
screen, not a hypothesis test: it chooses the pairs the lead-lag study
will then test out of sample on data these correlations never saw.
"""

import argparse
from datetime import datetime, timezone
import json
import re
import sys
import time
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import false_discovery_control, norm

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.data.market_universe import (  # noqa: E402
    fetch_live_events,
    flatten_markets,
    logit_changes,
    universe_prices,
)

STOP = {"Will", "The", "A", "An", "In", "On", "By", "Before", "After", "Of", "To", "For", "And", "Or",
        "Yes", "No", "Who", "What", "When", "Which", "How", "Does", "Do", "Is", "Are", "Be", "Win", "Wins",
        "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
        "November", "December", "US", "U.S.", "United", "States"}


def proper_tokens(question):
    toks = re.findall(r"[A-Z][A-Za-z'.-]+", question or "")
    return {t.strip(".'-") for t in toks if t.strip(".'-") not in STOP and len(t) > 2}


def fisher_p(r, n):
    z = np.arctanh(np.clip(r, -0.999999, 0.999999)) * np.sqrt(np.maximum(n - 3, 1))
    return 2 * norm.sf(np.abs(z))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=1500)
    ap.add_argument("--lookback", type=int, default=240)
    ap.add_argument("--min-days", type=int, default=90)
    ap.add_argument("--min-overlap", type=int, default=60)
    ap.add_argument("--min-active-frac", type=float, default=0.25, help="min fraction of days with a nonzero change")
    ap.add_argument("--min-median-price", type=float, default=0.05, help="drop markets whose median price is within this of 0 or 1 (tick-noise long shots)")
    ap.add_argument("--min-levels", type=int, default=30, help="min distinct daily price levels")
    ap.add_argument("--drop-k", type=int, default=3, help="pair must stay significant after dropping its k most influential days")
    ap.add_argument("--min-volume", type=float, default=250_000)
    ap.add_argument("--min-liquidity", type=float, default=5_000)
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--output-dir", type=Path, default=ROOT / "results")
    args = ap.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()

    t0 = time.time()
    events = fetch_live_events(max_events=args.max_events, refresh=args.refresh)
    markets = flatten_markets(events, min_volume=args.min_volume, min_liquidity=args.min_liquidity)
    print(f"{len(events)} live events -> {len(markets)} markets after metadata screen", flush=True)

    prices = universe_prices(
        markets, lookback_days=args.lookback, refresh=args.refresh,
        progress=lambda i, n: print(f"  prices {i}/{n} ({time.time() - t0:.0f}s)", flush=True),
    )
    print(f"price matrix {prices.shape}", flush=True)

    changes = logit_changes(prices)
    n_days = changes.notna().sum()
    active_frac = (changes.abs() > 1e-9).sum() / n_days.replace(0, np.nan)
    med = prices.median()
    levels = prices.nunique()
    keep = changes.columns[
        (n_days >= args.min_days)
        & (active_frac >= args.min_active_frac)
        & (med >= args.min_median_price)
        & (med <= 1 - args.min_median_price)
        & (levels >= args.min_levels)
    ]
    changes = changes[keep]
    meta = markets.set_index("market_id").loc[keep]
    meta.index.name = "market_id"
    print(
        f"{len(keep)} markets with >= {args.min_days} days, >= {args.min_active_frac:.0%} active days, "
        f"median price in [{args.min_median_price}, {1 - args.min_median_price}], >= {args.min_levels} levels",
        flush=True,
    )

    # pairwise Spearman correlation on common days (ranks within each
    # column's observed days; Pearson on ranks with masked sums)
    def masked_corr(frame):
        R = frame.rank().to_numpy()
        mask = ~np.isnan(R)
        Rz = np.where(mask, R, 0.0)
        M = mask.astype(float)
        n_common = M.T @ M
        S1 = Rz.T @ M
        S2 = (Rz ** 2).T @ M
        Sxy = Rz.T @ Rz
        with np.errstate(invalid="ignore", divide="ignore"):
            mi, mj = S1 / n_common, S1.T / n_common
            cov = Sxy / n_common - mi * mj
            vi, vj = S2 / n_common - mi ** 2, S2.T / n_common - mj ** 2
            corr = cov / np.sqrt(vi * vj)
        return corr, n_common

    def pair_table(frame, rcol="r"):
        corr, n_common = masked_corr(frame)
        ids = list(frame.columns)
        rows = []
        for a, b in combinations(range(len(ids)), 2):
            n = int(n_common[a, b])
            if n < args.min_overlap or not np.isfinite(corr[a, b]):
                continue
            rows.append((ids[a], ids[b], float(corr[a, b]), n))
        df = pd.DataFrame(rows, columns=["a", "b", rcol, "n"])
        df["p"] = fisher_p(df[rcol].to_numpy(), df["n"].to_numpy())
        df["q"] = false_discovery_control(df["p"], method="bh") if len(df) else []
        return df

    def drop_k_check(df, frame, rcol="r"):
        """Recompute each significant pair's Spearman r after removing its
        k most influential common days (largest |rank-product| deviation),
        and require it to stay significant at the same BH level."""
        out_r, out_p = [], []
        for row in df.itertuples():
            pair = frame[[row.a, row.b]].dropna()
            ra, rb = pair[row.a].rank(), pair[row.b].rank()
            infl = ((ra - ra.mean()) * (rb - rb.mean())).abs()
            kept = pair.drop(infl.nlargest(args.drop_k).index)
            r2 = kept[row.a].corr(kept[row.b], method="spearman") if len(kept) > 10 else np.nan
            out_r.append(r2)
            out_p.append(float(fisher_p(np.array([r2]), np.array([len(kept)]))[0]) if np.isfinite(r2) else np.nan)
        df = df.assign(**{f"{rcol}_drop{args.drop_k}": out_r, f"p_drop{args.drop_k}": out_p})
        return df

    pairs = pair_table(changes)
    print(f"{len(pairs)} pairs tested; {(pairs['q'] <= 0.05).sum()} pass BH at 0.05 before the drop-{args.drop_k} check", flush=True)
    sig0 = pairs[pairs["q"] <= 0.05].copy()
    sig0 = drop_k_check(sig0, changes)
    # BH threshold implied by the full test: largest passing p
    bh_thresh = float(pairs.loc[pairs["q"] <= 0.05, "p"].max()) if (pairs["q"] <= 0.05).any() else 0.0
    sig0["robust"] = sig0[f"p_drop{args.drop_k}"] <= bh_thresh
    pairs = pairs.merge(sig0[["a", "b", f"r_drop{args.drop_k}", f"p_drop{args.drop_k}", "robust"]], on=["a", "b"], how="left")
    pairs["robust"] = pairs["robust"].fillna(False).astype(bool)
    print(f"{int(pairs['robust'].sum())} pairs remain significant after dropping their {args.drop_k} most influential days", flush=True)

    # labels
    def label(a, b):
        ma, mb = meta.loc[a], meta.loc[b]
        if ma["event_slug"] == mb["event_slug"]:
            return "same_event"
        if set(ma["tag_slugs"]) & set(mb["tag_slugs"]):
            return "shared_tag"
        return "non_obvious"

    pairs["relation"] = [label(a, b) for a, b in zip(pairs["a"], pairs["b"])]
    pairs["shared_tags"] = [
        sorted(set(meta.loc[a, "tag_slugs"]) & set(meta.loc[b, "tag_slugs"])) for a, b in zip(pairs["a"], pairs["b"])
    ]
    pairs["shared_entities"] = [
        sorted(proper_tokens(meta.loc[a, "question"]) & proper_tokens(meta.loc[b, "question"]))
        for a, b in zip(pairs["a"], pairs["b"])
    ]

    # market-wide factor: equal-weight index of standardized changes per
    # day (robust with far more markets than days, unlike an SVD), then
    # residualize each market on it over its own days and re-screen.
    Z = (changes - changes.mean()) / changes.std(ddof=0).replace(0, np.nan)
    index = Z.mean(axis=1)
    factor_share = float(np.nanmean([Z[c].corr(index) ** 2 for c in Z.columns]))
    resid = {}
    for c in changes.columns:
        pair = pd.concat([changes[c], index], axis=1).dropna()
        if len(pair) < args.min_overlap:
            continue
        x, y = pair.iloc[:, 1].to_numpy(), pair.iloc[:, 0].to_numpy()
        beta = np.cov(x, y, ddof=0)[0, 1] / x.var() if x.var() > 0 else 0.0
        resid[c] = pd.Series(y - beta * x, index=pair.index)
    resid = pd.DataFrame(resid)
    resid_pairs = pair_table(resid, rcol="r_resid")
    sigr = resid_pairs[resid_pairs["q"] <= 0.05].copy()
    sigr = drop_k_check(sigr, resid, rcol="r_resid")
    bh_r = float(resid_pairs.loc[resid_pairs["q"] <= 0.05, "p"].max()) if (resid_pairs["q"] <= 0.05).any() else 0.0
    sigr["robust"] = sigr[f"p_drop{args.drop_k}"] <= bh_r
    resid_pairs = resid_pairs.merge(sigr[["a", "b", f"r_resid_drop{args.drop_k}", "robust"]], on=["a", "b"], how="left")
    resid_pairs["robust"] = resid_pairs["robust"].fillna(False).astype(bool)
    resid_pairs["relation"] = [label(a, b) for a, b in zip(resid_pairs["a"], resid_pairs["b"])]
    print(f"equal-weight index explains a mean {factor_share:.1%} of per-market variance; "
          f"{int(resid_pairs['robust'].sum())} residual pairs robustly significant", flush=True)

    def describe(df, rcol="r", n=args.top):
        out = []
        for row in df.head(n).itertuples():
            out.append(
                {
                    "a": row.a, "b": row.b,
                    "question_a": meta.loc[row.a, "question"], "question_b": meta.loc[row.b, "question"],
                    "event_a": meta.loc[row.a, "event_slug"], "event_b": meta.loc[row.b, "event_slug"],
                    "tags_a": meta.loc[row.a, "tag_slugs"], "tags_b": meta.loc[row.b, "tag_slugs"],
                    rcol: round(getattr(row, rcol), 3), "n": int(row.n), "q": float(row.q),
                    "relation": row.relation,
                    "shared_tags": getattr(row, "shared_tags", []),
                    "shared_entities": getattr(row, "shared_entities", []),
                }
            )
        return out

    sig = pairs[pairs["robust"]].copy()
    sig["abs_r"] = sig["r"].abs()
    sig = sig.sort_values("abs_r", ascending=False)
    non_obvious = sig[sig["relation"] == "non_obvious"]
    shared = sig[sig["relation"] == "shared_tag"]
    same = sig[sig["relation"] == "same_event"]

    result = {
        "params": vars(args),
        "n_events": len(events),
        "n_markets_screened": int(len(markets)),
        "n_markets_used": int(len(keep)),
        "n_pairs_tested": int(len(pairs)),
        "n_pairs_significant_before_dropk": int((pairs["q"] <= 0.05).sum()),
        "n_pairs_significant": int(len(sig)),
        "by_relation": sig["relation"].value_counts().to_dict(),
        "factor_share_pc1": factor_share,
        "top_non_obvious": describe(non_obvious),
        "top_shared_tag": describe(shared),
        "top_same_event": describe(same, n=15),
        "top_non_obvious_after_factor": (
            describe(
                resid_pairs[resid_pairs["robust"] & (resid_pairs["relation"] == "non_obvious")]
                .assign(abs_r=lambda d: d["r_resid"].abs())
                .sort_values("abs_r", ascending=False),
                rcol="r_resid",
            )
        ),
        "markets": meta.reset_index()[["market_id", "question", "event_slug", "tag_slugs", "volume", "liquidity", "start_date", "end_date"]]
        .assign(n_days=lambda d: d["market_id"].map(n_days), active_frac=lambda d: d["market_id"].map(active_frac))
        .to_dict(orient="records"),
    }
    # full graph for the interactive view: every usable market as a node,
    # every pair that is significant or moderately correlated as an edge
    GENERIC_ORDER = ["politics", "crypto", "sports", "business", "world", "science", "pop-culture", "culture"]
    def group_of(mid):
        tags = set(meta.loc[mid, "tags"])
        for g in GENERIC_ORDER:
            if g in tags:
                return "pop-culture" if g == "culture" else g
        return "other"
    med_price = prices[keep].median()
    nodes = [
        {
            "id": mid,
            "question": meta.loc[mid, "question"],
            "event_slug": meta.loc[mid, "event_slug"],
            "market_slug": meta.loc[mid, "market_slug"],
            "event_title": meta.loc[mid, "event_title"],
            "group": group_of(mid),
            "tags": meta.loc[mid, "tag_slugs"],
            "volume": float(meta.loc[mid, "volume"]),
            "median_price": float(med_price[mid]),
            "current_price": float(meta.loc[mid, "current_price"]) if pd.notna(meta.loc[mid, "current_price"]) else None,
            "n_days": int(n_days[mid]),
        }
        for mid in keep
    ]
    edge_df = pairs[(pairs["q"] <= 0.05) | (pairs["r"].abs() >= 0.15)].copy()
    edge_df["abs_r"] = edge_df["r"].abs()
    edge_df = edge_df.sort_values("abs_r", ascending=False).head(8000)
    edges = [
        {
            "a": row.a, "b": row.b, "r": round(row.r, 3), "n": int(row.n), "q": float(row.q),
            "robust": bool(row.robust), "relation": row.relation,
        }
        for row in edge_df.itertuples()
    ]
    graph_path = args.output_dir / "market_graph.json"
    graph_path.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(),
        "fetch_started_at": fetched_at,
        "params": {"lookback_days": args.lookback, "min_overlap": args.min_overlap, "min_median_price": args.min_median_price,
                   "min_levels": args.min_levels, "min_active_frac": args.min_active_frac, "drop_k": args.drop_k,
                   "edge_rule": "q <= 0.05 or |r| >= 0.15, top 8000 by |r|"},
        "n_screened": int(len(markets)), "n_long_shots_excluded": int(((med < args.min_median_price) | (med > 1 - args.min_median_price)).sum()),
        "nodes": nodes, "edges": edges,
    }))
    print(f"graph: {len(nodes)} nodes, {len(edges)} edges -> {graph_path}", flush=True)
    # daily price matrix for the graph's neighborhood charts (lazy-loaded by the site)
    pm = prices[keep]
    prices_path = args.output_dir / "market_graph_prices.json"
    prices_path.write_text(json.dumps({
        "dates": [d.strftime("%Y-%m-%d") for d in pm.index],
        "series": {c: [None if not np.isfinite(v) else round(float(v), 4) for v in pm[c]] for c in pm.columns},
    }))
    print(f"graph prices: {pm.shape} -> {prices_path}", flush=True)


    out = args.output_dir / "correlated_markets.json"
    out.write_text(json.dumps(result, indent=2, default=str))

    md = [f"# Correlated-market screen, {time.strftime('%Y-%m-%d')}\n",
          f"{len(events)} live events -> {len(markets)} markets after metadata screen -> {len(keep)} with usable daily series. "
          f"{len(pairs):,} pairs tested; {int((pairs['q'] <= 0.05).sum()):,} pass BH at 0.05 and {len(sig):,} stay significant after dropping each pair's {args.drop_k} most influential days ({sig['relation'].value_counts().to_dict()}). "
          f"An equal-weight market index explains a mean {factor_share:.1%} of per-market variance.\n"]
    for title, block, rcol in [
        ("Non-obvious pairs (different events, no shared specific tag)", result["top_non_obvious"], "r"),
        ("Non-obvious pairs after removing the first factor", result["top_non_obvious_after_factor"], "r_resid"),
        ("Shared-tag pairs (different events)", result["top_shared_tag"], "r"),
        ("Same-event pairs (mechanical, for reference)", result["top_same_event"], "r"),
    ]:
        md.append(f"\n## {title}\n\n| r | n | q | A | B | shared |\n|---:|---:|---:|---|---|---|")
        for p in block:
            shared_bits = ", ".join(p["shared_tags"] + p["shared_entities"])
            md.append(f"| {p[rcol]:+.2f} | {p['n']} | {p['q']:.1e} | {p['question_a']} | {p['question_b']} | {shared_bits} |")
    (args.output_dir / "correlated_markets.md").write_text("\n".join(md) + "\n")
    print(f"\nwrote {out} and .md in {time.time() - t0:.0f}s")
    print("\n".join(md[:2]))
    for title, block, rcol in [("NON-OBVIOUS", result["top_non_obvious"][:15], "r"),
                               ("NON-OBVIOUS AFTER FACTOR", result["top_non_obvious_after_factor"][:15], "r_resid")]:
        print(f"\n== {title}")
        for p in block:
            print(f"  {p[rcol]:+.2f} n={p['n']:3d} q={p['q']:.1e} | {p['question_a'][:55]} <-> {p['question_b'][:55]} | {', '.join(p['shared_entities'])}")


if __name__ == "__main__":
    main()
