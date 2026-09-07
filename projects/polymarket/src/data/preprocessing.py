"""Preprocessing for real Polymarket baskets: resolution-window exclusion
and a liquidity/coverage screen, with every threshold an explicit,
logged parameter.

Resolution artifact
-------------------
Every market's price converges mechanically to 0 or 1 as it resolves. That
is contract settlement, not a joint-structure event, so the last
`resolution_exclusion_days` before each market's *effective* resolution are
dropped for the whole basket. Effective resolution is the earlier of the
market's listed end date and the first date from which its price stays
pinned within `pinned_tol` of 0 or 1 for the rest of its life (an outcome
market of a multi-outcome event can become impossible months before the
event ends). The basket's analysis window ends at the earliest exclusion
start across its surviving markets.

Liquidity / coverage screen
---------------------------
A market enters the basket only if, over its own life up to its exclusion
start, it has at least `min_coverage` fraction of days observed, at most
`max_frac_unchanged` of consecutive observations identical (stale, untraded
prices), lifetime volume of at least `min_volume` USD, a median price at
least `min_median_price` from both 0 and 1 (a market pinned at 2 cents has
logit changes that are pure tick noise), and a life that covers at least
`min_life_fraction` of the basket's overall span (earliest market start to
latest effective resolution). The last rule is what stops one outcome
market that collapses early, or one that opens late, from truncating the
whole basket's window: such markets are dropped, the window is not. Thin
markets otherwise dominate a covariance with noise. Gaps in surviving
markets are forward-filled up to `max_ffill_days`; longer gaps leave the
day out of the window entirely.

Nothing here looks at the timing of shocks.
"""

import numpy as np
import pandas as pd

DEFAULT_PARAMS = {
    "resolution_exclusion_days": 14,
    "pinned_tol": 0.02,
    "min_coverage": 0.9,
    "max_frac_unchanged": 0.7,
    "min_volume": 100_000.0,
    "min_median_price": 0.05,
    "min_life_fraction": 0.75,
    "max_ffill_days": 3,
}


def effective_resolution(series, end_date, pinned_tol=0.02):
    """Earliest of `end_date` and the start of the terminal run in which
    the price stays within `pinned_tol` of 0 or 1 through its last
    observation."""
    obs = series.dropna()
    end = pd.Timestamp(end_date)
    if end.tzinfo is None:
        end = end.tz_localize("UTC")
    if obs.empty:
        return end
    pinned = (obs <= pinned_tol) | (obs >= 1 - pinned_tol)
    if not pinned.iloc[-1]:
        return min(end, obs.index[-1])
    # walk back from the end while pinned
    unpinned = np.where(~pinned.values)[0]
    start_idx = unpinned[-1] + 1 if len(unpinned) else 0
    return min(end, obs.index[start_idx])


def preprocess_basket(prices, markets, params=None, verbose=False):
    """prices: DataFrame indexed by UTC timestamp, one column per market_id.
    markets: DataFrame from polymarket_client.event_markets rows for the
    basket, indexed to match `prices` columns via 'market_id'.

    Returns (clean_prices, report) where clean_prices is the aligned,
    forward-filled price matrix restricted to the analysis window and the
    surviving markets, and report records every decision."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    meta = markets.set_index("market_id")
    report = {"params": p, "markets": {}, "dropped": {}}

    # 1. effective resolution per market and the basket window end
    exclusion_starts = {}
    for mid in prices.columns:
        res = effective_resolution(prices[mid], meta.loc[mid, "end_date"], p["pinned_tol"])
        exclusion_starts[mid] = res - pd.Timedelta(days=p["resolution_exclusion_days"])
        report["markets"][mid] = {
            "label": meta.loc[mid].get("label", mid),
            "effective_resolution": str(res),
            "exclusion_start": str(exclusion_starts[mid]),
        }

    # 2. liquidity / coverage screen, evaluated on each market's own life up
    #    to its exclusion start (so a market is judged on the stretch it
    #    could contribute)
    firsts = {mid: prices[mid].dropna().index.min() for mid in prices.columns}
    resolutions = {
        mid: exclusion_starts[mid] + pd.Timedelta(days=p["resolution_exclusion_days"])
        for mid in prices.columns
    }
    span_start = min(v for v in firsts.values() if pd.notna(v))
    span_end = max(resolutions.values())
    span_days = max(1, (span_end - span_start).days)
    report["basket_span"] = (str(span_start), str(span_end))

    keep = []
    for mid in prices.columns:
        s = prices[mid].loc[: exclusion_starts[mid]].dropna()
        life_days = max(1, (s.index.max() - s.index.min()).days + 1) if len(s) else 1
        coverage = len(s) / life_days
        frac_unchanged = float((s.diff().dropna() == 0).mean()) if len(s) > 1 else 1.0
        volume = float(meta.loc[mid, "volume"])
        median_price = float(s.median()) if len(s) else np.nan
        life_fraction = (
            max(0.0, (resolutions[mid] - firsts[mid]).days) / span_days if pd.notna(firsts[mid]) else 0.0
        )
        info = report["markets"][mid]
        info.update(
            {
                "n_obs": int(len(s)),
                "coverage": coverage,
                "frac_unchanged": frac_unchanged,
                "volume": volume,
                "median_price": median_price,
                "life_fraction": life_fraction,
            }
        )
        reasons = []
        if coverage < p["min_coverage"]:
            reasons.append(f"coverage {coverage:.2f} < {p['min_coverage']}")
        if frac_unchanged > p["max_frac_unchanged"]:
            reasons.append(f"frac_unchanged {frac_unchanged:.2f} > {p['max_frac_unchanged']}")
        if volume < p["min_volume"]:
            reasons.append(f"volume {volume:.0f} < {p['min_volume']:.0f}")
        if not (p["min_median_price"] <= median_price <= 1 - p["min_median_price"]):
            reasons.append(f"median price {median_price:.3f} within {p['min_median_price']} of 0/1")
        if life_fraction < p["min_life_fraction"]:
            reasons.append(f"life fraction {life_fraction:.2f} < {p['min_life_fraction']}")
        if reasons:
            report["dropped"][mid] = reasons
        else:
            keep.append(mid)
    if len(keep) < 2:
        raise ValueError(f"fewer than 2 markets survive the screen: {report['dropped']}")

    # 3. common window: latest first observation to earliest exclusion start
    start = max(prices[mid].dropna().index.min() for mid in keep)
    end = min(exclusion_starts[mid] for mid in keep)
    if end <= start:
        raise ValueError(f"empty analysis window: start {start} >= end {end}")
    clean = prices.loc[start:end, keep]

    # 4. bounded forward fill, then drop days any market still lacks
    clean = clean.ffill(limit=p["max_ffill_days"])
    n_before = len(clean)
    clean = clean.dropna(how="any")
    report.update(
        {
            "kept": keep,
            "window_start": str(start),
            "window_end": str(end),
            "n_days_in_window": n_before,
            "n_days_used": int(len(clean)),
        }
    )
    if verbose:
        print(f"window {start.date()} -> {end.date()}: {len(clean)} days, {len(keep)} markets")
        for mid, reasons in report["dropped"].items():
            print(f"  dropped {report['markets'][mid]['label']}: {'; '.join(reasons)}")
    return clean, report
