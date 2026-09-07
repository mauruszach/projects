"""Ties a curated basket (market_clusters) to the API client and the
preprocessing screen, and registers the result as a harness dataset.

Dataset "polymarket_basket" params:
  basket:            name in market_clusters.BASKETS
  window_size, stride, transform, shrinkage:  as for synthetic_basket
  preprocessing:     overrides for preprocessing.DEFAULT_PARAMS
  shock_dates:       list of ISO dates, curated independently of the price
                     data (CLAUDE.md phase 5). The event signal flags every
                     window whose span contains a shock date. Required: a
                     basket without curated shock dates cannot be validated,
                     and the harness refuses to run without an event signal.
  event_tolerance:   window flagged if 0 <= (window end - shock) < tolerance
                     days; defaults to window_size (shock inside window).
  refresh:           re-pull from the API instead of using the disk cache.
"""

import numpy as np
import pandas as pd

from src.covariance.rolling_covariance import price_changes, rolling_covariances
from src.data.market_clusters import get_basket
from src.data.polymarket_client import basket_prices, event_markets
from src.data.preprocessing import preprocess_basket
from src.experiment_harness import register_dataset


def basket_markets(basket, refresh=False):
    """Resolve each MarketSpec to a Gamma market row; one row per spec."""
    rows = []
    for spec in basket.markets:
        markets = event_markets(spec.event_slug, refresh=refresh)
        match = markets[markets["question"].str.contains(spec.question_contains, regex=False)]
        if len(match) != 1:
            raise ValueError(
                f"{spec.event_slug}: {len(match)} markets match {spec.question_contains!r}; "
                f"questions: {markets['question'].tolist()}"
            )
        row = match.iloc[0].to_dict()
        row["label"] = spec.label
        rows.append(row)
    return pd.DataFrame(rows)


def load_basket(name, preprocessing=None, refresh=False, verbose=False):
    """Returns (clean_prices, markets, report) for a curated basket."""
    basket = get_basket(name)
    markets = basket_markets(basket, refresh=refresh)
    prices = basket_prices(markets, fidelity_minutes=basket.fidelity_minutes, refresh=refresh)
    clean, report = preprocess_basket(prices, markets, params=preprocessing, verbose=verbose)
    clean.columns = [markets.set_index("market_id").loc[c, "label"] for c in clean.columns]
    report["basket"] = name
    report["category"] = basket.category
    return clean, markets, report


def shock_event_signal_dates(window_end_dates, shock_dates, tolerance_days):
    ends = pd.DatetimeIndex(window_end_dates)
    signal = np.zeros(len(ends))
    for d in shock_dates:
        shock = pd.Timestamp(d)
        if shock.tzinfo is None:
            shock = shock.tz_localize("UTC")
        lag_days = (ends - shock).days
        signal[(lag_days >= 0) & (lag_days < tolerance_days)] = 1.0
    return signal


@register_dataset("polymarket_basket")
def polymarket_basket_dataset(
    basket,
    shock_dates,
    window_size=30,
    stride=1,
    transform="logit",
    shrinkage="ledoit_wolf",
    preprocessing=None,
    event_tolerance=None,
    refresh=False,
):
    if not shock_dates:
        raise ValueError("shock_dates is required; curate them before running (CLAUDE.md phase 5)")
    clean, markets, report = load_basket(basket, preprocessing=preprocessing, refresh=refresh)
    changes = price_changes(clean.to_numpy(), transform=transform)
    rolled = rolling_covariances(changes, window_size, stride=stride, shrinkage=shrinkage)
    # change-row index t is price index t + 1; map window ends back to dates
    end_dates = clean.index[rolled["window_end_price_index"]]
    tolerance = window_size if event_tolerance is None else int(event_tolerance)
    event_signal = shock_event_signal_dates(end_dates, shock_dates, tolerance)
    return {
        "covariances": rolled["covariances"],
        "event_signal": event_signal,
        "window_end_dates": end_dates,
        "window_size": window_size,
        "stride": stride,
        "shock_dates": list(shock_dates),
        "prices": clean,
        "changes": changes,
        "markets": markets,
        "preprocessing_report": report,
    }
