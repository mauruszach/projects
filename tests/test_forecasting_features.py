from datetime import datetime, timedelta, timezone

from app.forecasting.features import compute_actor_window_features

WINDOW_START = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)
WINDOW_END = WINDOW_START + timedelta(hours=8)
MIDPOINT = WINDOW_START + timedelta(hours=4)


def _event(hours_offset: float, goldstein: float, tone: float, counterpart: str | None) -> dict:
    return {
        "timestamp": WINDOW_START + timedelta(hours=hours_offset),
        "goldstein_scale": goldstein,
        "avg_tone": tone,
        "counterpart_code": counterpart,
    }


def test_compute_features_empty_events_returns_none() -> None:
    assert compute_actor_window_features("USA", [], WINDOW_START, WINDOW_END) is None


def test_compute_features_basic_aggregates() -> None:
    events = [
        _event(1, goldstein=2.0, tone=-1.0, counterpart="RUS"),
        _event(2, goldstein=4.0, tone=1.0, counterpart="CHN"),
        _event(6, goldstein=-2.0, tone=-3.0, counterpart="RUS"),
        _event(7, goldstein=0.0, tone=-1.0, counterpart="IRN"),
    ]
    features = compute_actor_window_features("USA", events, WINDOW_START, WINDOW_END)

    assert features is not None
    assert features.actor_code == "USA"
    assert features.event_count == 4
    assert features.avg_goldstein == 1.0  # (2 + 4 - 2 + 0) / 4
    assert features.degree == 3  # RUS, CHN, IRN

    # Early half (hours 1,2): avg goldstein = 3.0; late half (hours 6,7): avg = -1.0
    assert features.goldstein_trend == -4.0
    # Early half tone avg = 0.0; late half tone avg = -2.0
    assert features.tone_trend == -2.0


def test_compute_features_degree_ignores_missing_counterpart() -> None:
    events = [
        _event(1, goldstein=1.0, tone=0.0, counterpart=None),
        _event(2, goldstein=1.0, tone=0.0, counterpart="RUS"),
    ]
    features = compute_actor_window_features("USA", events, WINDOW_START, WINDOW_END)
    assert features is not None
    assert features.degree == 1


def test_compute_features_trend_zero_when_one_half_empty() -> None:
    events = [_event(1, goldstein=1.0, tone=0.0, counterpart="RUS")]
    features = compute_actor_window_features("USA", events, WINDOW_START, WINDOW_END)
    assert features is not None
    assert features.goldstein_trend == 0.0
    assert features.tone_trend == 0.0


def test_to_vector_order_matches_feature_names() -> None:
    events = [_event(1, goldstein=2.0, tone=-1.0, counterpart="RUS")]
    features = compute_actor_window_features("USA", events, WINDOW_START, WINDOW_END)
    assert features is not None
    vector = features.to_vector()
    assert vector == [
        float(features.event_count),
        features.avg_goldstein,
        features.goldstein_trend,
        features.avg_tone,
        features.tone_trend,
        float(features.degree),
    ]
