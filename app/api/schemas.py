from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator


def _coerce_timestamp(value: object) -> object:
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else value


Neo4jTimestamp = Annotated[datetime, BeforeValidator(_coerce_timestamp)]


class ActorSummary(BaseModel):
    code: str
    name: str
    actor_type: str


class LocationSummary(BaseModel):
    name: str
    lat: float | None = None
    long: float | None = None


class EventSummary(BaseModel):
    event_id: str
    event_code: str
    goldstein_scale: float
    avg_tone: float
    timestamp: Neo4jTimestamp
    source_url: str
    actor1: ActorSummary | None = None
    actor2: ActorSummary | None = None
    location: LocationSummary | None = None


class ActorTimelineEntry(BaseModel):
    event_id: str
    event_code: str
    goldstein_scale: float
    avg_tone: float
    timestamp: Neo4jTimestamp
    role: Literal["initiated", "targeted"]
    counterpart: ActorSummary | None = None
    location: LocationSummary | None = None


class ActorSubgraphResponse(BaseModel):
    actor: ActorSummary
    counterparts: list[ActorSummary]
    locations: list[LocationSummary]
    events: list[ActorTimelineEntry]
