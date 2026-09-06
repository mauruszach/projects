from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_graph_client
from app.api.schemas import ActorSubgraphResponse, ActorSummary, ActorTimelineEntry, LocationSummary
from app.graph import queries
from app.graph.client import Neo4jClient

router = APIRouter(prefix="/graph", tags=["graph"])


def _row_to_timeline_entry(row: dict) -> ActorTimelineEntry:
    counterpart = None
    if row["counterpart_code"]:
        counterpart = ActorSummary(
            code=row["counterpart_code"],
            name=row["counterpart_name"],
            actor_type=row["counterpart_type"] or "unknown",
        )
    location = None
    if row["location_name"]:
        location = LocationSummary(
            name=row["location_name"], lat=row["location_lat"], long=row["location_long"]
        )
    return ActorTimelineEntry(
        event_id=row["event_id"],
        event_code=row["event_code"],
        goldstein_scale=row["goldstein_scale"],
        avg_tone=row["avg_tone"],
        timestamp=row["timestamp"],
        role=row["role"],
        counterpart=counterpart,
        location=location,
    )


@router.get("/actors/{actor_code}", response_model=ActorSummary)
async def get_actor(
    actor_code: str, client: Neo4jClient = Depends(get_graph_client)
) -> ActorSummary:
    row = await queries.get_actor(client, actor_code)
    if row is None:
        raise HTTPException(status_code=404, detail="actor not found")
    return ActorSummary(code=row["code"], name=row["name"], actor_type=row["actor_type"])


@router.get("/actors/{actor_code}/timeline", response_model=list[ActorTimelineEntry])
async def get_actor_timeline(
    actor_code: str,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    client: Neo4jClient = Depends(get_graph_client),
) -> list[ActorTimelineEntry]:
    rows = await queries.get_actor_events(client, actor_code, start, end, limit)
    return [_row_to_timeline_entry(row) for row in rows]


@router.get("/actors/{actor_code}/subgraph", response_model=ActorSubgraphResponse)
async def get_actor_subgraph(
    actor_code: str,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    client: Neo4jClient = Depends(get_graph_client),
) -> ActorSubgraphResponse:
    actor_row = await queries.get_actor(client, actor_code)
    if actor_row is None:
        raise HTTPException(status_code=404, detail="actor not found")

    rows = await queries.get_actor_events(client, actor_code, start, end, limit)
    events = [_row_to_timeline_entry(row) for row in rows]

    counterparts: dict[str, ActorSummary] = {}
    locations: dict[str, LocationSummary] = {}
    for event in events:
        if event.counterpart:
            counterparts[event.counterpart.code] = event.counterpart
        if event.location:
            locations[event.location.name] = event.location

    return ActorSubgraphResponse(
        actor=ActorSummary(
            code=actor_row["code"], name=actor_row["name"], actor_type=actor_row["actor_type"]
        ),
        counterparts=list(counterparts.values()),
        locations=list(locations.values()),
        events=events,
    )
