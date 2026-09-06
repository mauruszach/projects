from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.graph import queries
from app.graph.client import Neo4jClient

# A coarse, documented threshold: escalation is defined as the actor's average
# Goldstein scale dropping by at least this many points from the feature window
# to the label window. Goldstein scale is a noisy proxy for real escalation --
# see CLAUDE.md "Known risks" -- so this threshold is a modeling choice, not a
# ground-truth definition.
ESCALATION_THRESHOLD = 1.0

FEATURE_NAMES = [
    "event_count",
    "avg_goldstein",
    "goldstein_trend",
    "avg_tone",
    "tone_trend",
    "degree",
]


@dataclass
class ActorWindowFeatures:
    actor_code: str
    window_start: datetime
    event_count: int
    avg_goldstein: float
    goldstein_trend: float
    avg_tone: float
    tone_trend: float
    degree: int

    def to_vector(self) -> list[float]:
        return [
            float(self.event_count),
            self.avg_goldstein,
            self.goldstein_trend,
            self.avg_tone,
            self.tone_trend,
            float(self.degree),
        ]


def _to_native_dt(value: object) -> datetime:
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else value  # type: ignore[return-value]


def _half_split_trend(events: list[dict], midpoint: datetime, key: str) -> float:
    early = [e[key] for e in events if e["timestamp"] < midpoint]
    late = [e[key] for e in events if e["timestamp"] >= midpoint]
    if not early or not late:
        return 0.0
    return (sum(late) / len(late)) - (sum(early) / len(early))


def compute_actor_window_features(
    actor_code: str,
    events: list[dict],
    window_start: datetime,
    window_end: datetime,
) -> ActorWindowFeatures | None:
    if not events:
        return None

    midpoint = window_start + (window_end - window_start) / 2
    goldstein_values = [e["goldstein_scale"] for e in events]
    tone_values = [e["avg_tone"] for e in events]
    degree = len({e["counterpart_code"] for e in events if e.get("counterpart_code")})

    return ActorWindowFeatures(
        actor_code=actor_code,
        window_start=window_start,
        event_count=len(events),
        avg_goldstein=sum(goldstein_values) / len(goldstein_values),
        goldstein_trend=_half_split_trend(events, midpoint, "goldstein_scale"),
        avg_tone=sum(tone_values) / len(tone_values),
        tone_trend=_half_split_trend(events, midpoint, "avg_tone"),
        degree=degree,
    )


async def build_actor_window_sample(
    client: Neo4jClient,
    actor_code: str,
    feature_start: datetime,
    feature_end: datetime,
    label_end: datetime,
    min_events: int = 3,
    query_limit: int = 20000,
) -> tuple[ActorWindowFeatures, int] | None:
    """Build one (features, label) example for one actor anchored at feature_start.

    Label = 1 if the actor's average Goldstein scale over [feature_end, label_end)
    drops by at least ESCALATION_THRESHOLD points relative to [feature_start,
    feature_end) -- i.e. events involving the actor turned more conflictual.
    Returns None when either window has too few events to estimate reliably.
    """
    rows = await queries.get_actor_events(
        client, actor_code, feature_start, label_end, limit=query_limit
    )
    for row in rows:
        row["timestamp"] = _to_native_dt(row["timestamp"])

    feature_events = [r for r in rows if feature_start <= r["timestamp"] < feature_end]
    label_events = [r for r in rows if feature_end <= r["timestamp"] < label_end]

    if len(feature_events) < min_events or len(label_events) < min_events:
        return None

    features = compute_actor_window_features(actor_code, feature_events, feature_start, feature_end)
    if features is None:
        return None

    label_avg_goldstein = sum(e["goldstein_scale"] for e in label_events) / len(label_events)
    label = int(label_avg_goldstein <= features.avg_goldstein - ESCALATION_THRESHOLD)

    return features, label
