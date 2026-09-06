from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_graph_client
from app.api.schemas import ActorSummary, EventSummary, LocationSummary
from app.graph import queries
from app.graph.client import Neo4jClient

router = APIRouter(prefix="/events", tags=["events"])


def _row_to_event_summary(row: dict) -> EventSummary:
    actor1 = None
    if row["actor1_code"]:
        actor1 = ActorSummary(
            code=row["actor1_code"], name=row["actor1_name"], actor_type=row["actor1_type"] or "unknown"
        )
    actor2 = None
    if row["actor2_code"]:
        actor2 = ActorSummary(
            code=row["actor2_code"], name=row["actor2_name"], actor_type=row["actor2_type"] or "unknown"
        )
    location = None
    if row["location_name"]:
        location = LocationSummary(
            name=row["location_name"], lat=row["location_lat"], long=row["location_long"]
        )
    return EventSummary(
        event_id=row["event_id"],
        event_code=row["event_code"],
        goldstein_scale=row["goldstein_scale"],
        avg_tone=row["avg_tone"],
        timestamp=row["timestamp"],
        source_url=row["source_url"],
        actor1=actor1,
        actor2=actor2,
        location=location,
    )


@router.get("", response_model=list[EventSummary])
async def list_events(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    event_code: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    client: Neo4jClient = Depends(get_graph_client),
) -> list[EventSummary]:
    rows = await queries.list_events(client, start, end, event_code, limit)
    return [_row_to_event_summary(row) for row in rows]


@router.get("/{event_id}", response_model=EventSummary)
async def get_event(
    event_id: str, client: Neo4jClient = Depends(get_graph_client)
) -> EventSummary:
    row = await queries.get_event(client, event_id)
    if row is None:
        raise HTTPException(status_code=404, detail="event not found")
    return _row_to_event_summary(row)
