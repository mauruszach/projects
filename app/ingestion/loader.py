from __future__ import annotations

from app.graph import queries
from app.graph.client import Neo4jClient
from app.graph.schema import ParsedEvent


async def load_events(client: Neo4jClient, records: list[ParsedEvent]) -> int:
    actors: dict[str, dict] = {}
    locations: dict[str, dict] = {}
    events: list[dict] = []
    initiated: list[dict] = []
    targeted: list[dict] = []
    occurred_at: list[dict] = []

    for record in records:
        events.append(record.event.model_dump())

        if record.actor1:
            actors[record.actor1.code] = record.actor1.model_dump()
            initiated.append({"actor_code": record.actor1.code, "event_id": record.event.event_id})

        if record.actor2:
            actors[record.actor2.code] = record.actor2.model_dump()
            targeted.append({"event_id": record.event.event_id, "actor_code": record.actor2.code})

        if record.location:
            locations[record.location.name] = record.location.model_dump()
            occurred_at.append(
                {"event_id": record.event.event_id, "location_name": record.location.name}
            )

    if actors:
        await queries.upsert_actors(client, list(actors.values()))
    if locations:
        await queries.upsert_locations(client, list(locations.values()))
    if events:
        await queries.upsert_events(client, events)
    if initiated:
        await queries.link_initiated(client, initiated)
    if targeted:
        await queries.link_targeted(client, targeted)
    if occurred_at:
        await queries.link_occurred_at(client, occurred_at)

    return len(events)
