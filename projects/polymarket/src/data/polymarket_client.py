"""Polymarket historical price and metadata pulls, cached on disk.

Two public, unauthenticated endpoints:

  Gamma  https://gamma-api.polymarket.com/events?slug=...   market metadata
  CLOB   https://clob.polymarket.com/prices-history          price history
           ?market=<clob token id>&interval=max&fidelity=<minutes>

A Gamma "event" groups the markets that share a real-world question (all
candidates in one election, all outcomes of one state race); each market
has two CLOB token ids, [Yes, No]. We always pull the Yes token, so a price
is the implied probability of the market's stated outcome.

Everything is cached under data/cache/ as JSON so a basket is pulled once
and analyses are reproducible offline. Delete a cache file to refresh it.
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

GAMMA_URL = "https://gamma-api.polymarket.com"
CLOB_URL = "https://clob.polymarket.com"
CACHE_DIR = Path(os.environ.get("POLYMARKET_CACHE_DIR", str(Path(__file__).resolve().parents[2] / "data" / "cache")))

_session = requests.Session()
_session.headers["User-Agent"] = "polymarket-geodesic-deviation/0.1"


def _get_json(url, params, retries=3, timeout=30):
    last = None
    for attempt in range(retries):
        try:
            resp = _session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} {params} failed after {retries} attempts: {last}")


def _cached(name, fetch, refresh=False):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    data = fetch()
    path.write_text(json.dumps(data))
    return data


def _parse_json_field(value):
    """Gamma serializes list fields (clobTokenIds, outcomes) as JSON strings."""
    if isinstance(value, str):
        return json.loads(value)
    return value


def get_event(slug, refresh=False):
    """Full Gamma event record (with its markets) for an event slug."""

    def fetch():
        events = _get_json(f"{GAMMA_URL}/events", {"slug": slug})
        if not events:
            raise KeyError(f"no Gamma event with slug {slug!r}")
        return events[0]

    return _cached(f"event_{slug}", fetch, refresh=refresh)


def event_markets(slug, refresh=False):
    """Tidy per-market metadata for an event: one row per market, with the
    Yes-token id, dates, and lifetime volume. Nothing is filtered here;
    liquidity and resolution handling live in preprocessing so the
    thresholds are explicit experiment parameters."""
    event = get_event(slug, refresh=refresh)
    rows = []
    for m in event["markets"]:
        tokens = _parse_json_field(m.get("clobTokenIds")) or []
        outcomes = _parse_json_field(m.get("outcomes")) or []
        if len(tokens) < 1:
            continue
        rows.append(
            {
                "event_slug": slug,
                "market_id": str(m["id"]),
                "market_slug": m.get("slug"),
                "question": m.get("question"),
                "yes_token_id": tokens[0],
                "outcomes": outcomes,
                "start_date": m.get("startDate"),
                "end_date": m.get("endDate"),
                "closed": bool(m.get("closed")),
                "volume": float(m.get("volumeNum") or m.get("volume") or 0.0),
            }
        )
    return pd.DataFrame(rows)


def price_history(token_id, fidelity_minutes=1440, refresh=False):
    """Price history for one CLOB token as a Series indexed by UTC
    timestamp. `fidelity_minutes` is the CLOB sampling interval (1440 =
    daily, 60 = hourly)."""

    def fetch():
        return _get_json(
            f"{CLOB_URL}/prices-history",
            {"market": token_id, "interval": "max", "fidelity": fidelity_minutes},
        )

    data = _cached(f"prices_{token_id}_{fidelity_minutes}", fetch, refresh=refresh)
    history = data.get("history", [])
    if not history:
        return pd.Series(dtype=float, name=token_id)
    ts = pd.to_datetime([h["t"] for h in history], unit="s", utc=True)
    return pd.Series([float(h["p"]) for h in history], index=ts, name=token_id)


def basket_prices(markets, fidelity_minutes=1440, refresh=False):
    """Pull every market's Yes-token history and align them on a common
    time grid (one column per market, indexed by the CLOB timestamps
    rounded to the fidelity). Cells where a market has no observation are
    NaN; forward-filling and liquidity screening are preprocessing
    decisions, not made here."""
    freq = f"{fidelity_minutes}min"
    columns = {}
    for _, row in markets.iterrows():
        series = price_history(row["yes_token_id"], fidelity_minutes, refresh=refresh)
        if series.empty:
            continue
        series.index = series.index.round(freq)
        series = series[~series.index.duplicated(keep="last")]
        columns[row["market_id"]] = series
    if not columns:
        return pd.DataFrame()
    frame = pd.DataFrame(columns).sort_index()
    return frame


def utc_now():
    return datetime.now(timezone.utc)


def describe_basket(markets, prices):
    """Per-market coverage summary to eyeball before choosing thresholds."""
    rows = []
    for _, m in markets.iterrows():
        col = prices.get(m["market_id"])
        if col is None:
            rows.append({**m.to_dict(), "n_obs": 0})
            continue
        obs = col.dropna()
        rows.append(
            {
                "market_id": m["market_id"],
                "question": m["question"][:60],
                "volume": m["volume"],
                "n_obs": int(len(obs)),
                "first": obs.index.min() if len(obs) else None,
                "last": obs.index.max() if len(obs) else None,
                "frac_unchanged": float(np.mean(np.diff(obs.values) == 0)) if len(obs) > 1 else np.nan,
                "end_date": m["end_date"],
            }
        )
    return pd.DataFrame(rows)
