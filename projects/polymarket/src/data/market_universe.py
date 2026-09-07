"""A broad, liquidity-screened universe of live Polymarket markets with
their Gamma tags, plus aligned daily price histories.

Gamma's /events endpoint returns each event's tags and its markets in one
record, sorted by volume, 100 per page, offset-paginated to roughly 2,400.
That is the natural way to build a cross-category universe: tags are how
"obviously related" gets defined later. Price history still comes from the
CLOB (Gamma has only current prices); see polymarket_client.

Nothing here looks at prices when choosing markets. The screen is on
metadata (volume, liquidity, age, open order book) and, afterwards, on
coverage of the daily series.
"""

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from src.data.polymarket_client import CACHE_DIR, GAMMA_URL, _get_json, price_history

GENERIC_TAGS = {"politics", "sports", "crypto", "business", "pop-culture", "science", "world", "culture"}


def fetch_live_events(max_events=1500, page=100, refresh=False):
    """Active, unresolved events sorted by volume, with tags and markets."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"live_events_{max_events}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    events = []
    for offset in range(0, max_events, page):
        batch = _get_json(
            f"{GAMMA_URL}/events",
            {
                "active": "true",
                "closed": "false",
                "order": "volume",
                "ascending": "false",
                "limit": page,
                "offset": offset,
            },
        )
        if not batch:
            break
        events.extend(batch)
        if len(batch) < page:
            break
    path.write_text(json.dumps(events))
    return events


def flatten_markets(events, min_volume=250_000.0, min_liquidity=5_000.0, min_age_days=90, now=None):
    """One row per market that clears the metadata screen. Tags come from
    the parent event; `tag_slugs` excludes the very generic top-level tags
    so 'shares a tag' means something."""
    now = now or datetime.now(timezone.utc)
    rows = []
    for ev in events:
        tags = [t.get("slug") for t in ev.get("tags", []) if t.get("slug")]
        specific = sorted(set(tags) - GENERIC_TAGS)
        for m in ev.get("markets", []):
            if m.get("closed") or not m.get("active") or not m.get("enableOrderBook", True):
                continue
            try:
                tokens = json.loads(m.get("clobTokenIds") or "[]")
            except json.JSONDecodeError:
                tokens = []
            if not tokens:
                continue
            start = m.get("startDate") or ev.get("startDate")
            if not start:
                continue
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            if (now - start_dt).days < min_age_days:
                continue
            volume = float(m.get("volumeNum") or m.get("volume") or 0)
            liquidity = float(m.get("liquidityNum") or m.get("liquidity") or 0)
            if volume < min_volume or liquidity < min_liquidity:
                continue
            try:
                quoted = m.get("outcomePrices") or []
                quoted = json.loads(quoted) if isinstance(quoted, str) else quoted
                current_price = float(quoted[0]) if quoted else None
                if current_price is not None and not 0 <= current_price <= 1:
                    current_price = None
            except (ValueError, TypeError, IndexError):
                current_price = None
            rows.append(
                {
                    "market_id": str(m["id"]),
                    "current_price": current_price,
                    "question": m.get("question"),
                    "market_slug": m.get("slug"),
                    "event_slug": ev.get("slug"),
                    "event_title": ev.get("title"),
                    "neg_risk": bool(ev.get("negRisk")),
                    "yes_token_id": tokens[0],
                    "start_date": start[:10],
                    "end_date": (m.get("endDate") or ev.get("endDate") or "")[:10],
                    "volume": volume,
                    "liquidity": liquidity,
                    "tags": tags,
                    "tag_slugs": specific,
                }
            )
    df = pd.DataFrame(rows)
    return df.drop_duplicates("market_id").reset_index(drop=True)


def universe_prices(markets, lookback_days=240, fidelity_minutes=1440, refresh=False, progress=None):
    """Aligned daily Yes-price matrix over the trailing `lookback_days`.
    Columns are market ids; missing days are NaN (no fill here)."""
    cutoff = pd.Timestamp.now(tz="UTC").normalize() - pd.Timedelta(days=lookback_days)
    cols = {}
    for i, row in enumerate(markets.itertuples()):
        if progress and i % 100 == 0:
            progress(i, len(markets))
        s = price_history(row.yes_token_id, fidelity_minutes, refresh=refresh)
        if s.empty:
            continue
        s.index = s.index.round(f"{fidelity_minutes}min")
        s = s[~s.index.duplicated(keep="last")]
        s = s[s.index >= cutoff]
        if len(s):
            cols[row.market_id] = s
    return pd.DataFrame(cols).sort_index()


def logit_changes(prices, eps=1e-4):
    p = prices.clip(eps, 1 - eps)
    return np.log(p / (1 - p)).diff()
