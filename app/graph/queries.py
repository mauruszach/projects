from __future__ import annotations

from datetime import datetime

from app.graph.client import Neo4jClient

_UPSERT_ACTORS = """
UNWIND $actors AS actor
MERGE (a:Actor {code: actor.code})
ON CREATE SET a.name = actor.name, a.type = actor.actor_type
ON MATCH SET a.name = actor.name
"""

_UPSERT_LOCATIONS = """
UNWIND $locations AS loc
MERGE (l:Location {name: loc.name})
ON CREATE SET l.lat = loc.lat, l.long = loc.long
"""

_UPSERT_EVENTS = """
UNWIND $events AS event
MERGE (e:Event {event_id: event.event_id})
ON CREATE SET e.event_code = event.event_code,
              e.goldstein_scale = event.goldstein_scale,
              e.avg_tone = event.avg_tone,
              e.timestamp = event.timestamp,
              e.source_url = event.source_url
"""

_LINK_INITIATED = """
UNWIND $links AS link
MATCH (a:Actor {code: link.actor_code})
MATCH (e:Event {event_id: link.event_id})
MERGE (a)-[:INITIATED]->(e)
"""

_LINK_TARGETED = """
UNWIND $links AS link
MATCH (e:Event {event_id: link.event_id})
MATCH (a:Actor {code: link.actor_code})
MERGE (e)-[:TARGETED]->(a)
"""

_LINK_OCCURRED_AT = """
UNWIND $links AS link
MATCH (e:Event {event_id: link.event_id})
MATCH (l:Location {name: link.location_name})
MERGE (e)-[:OCCURRED_AT]->(l)
"""

_GET_ACTOR = """
MATCH (a:Actor {code: $code})
RETURN a.code AS code, a.name AS name, a.type AS actor_type
"""

# Events where the actor is either the initiator or the target, each paired
# with its counterpart actor (if any) and location (if any).
_ACTOR_EVENTS = """
MATCH (a:Actor {code: $code})
CALL (a) {
  MATCH (a)-[:INITIATED]->(e:Event)
  WHERE ($start IS NULL OR e.timestamp >= $start) AND ($end IS NULL OR e.timestamp <= $end)
  OPTIONAL MATCH (e)-[:TARGETED]->(counterpart:Actor)
  OPTIONAL MATCH (e)-[:OCCURRED_AT]->(l:Location)
  RETURN e AS event, 'initiated' AS role, counterpart AS counterpart, l AS location
  UNION
  MATCH (e:Event)-[:TARGETED]->(a)
  WHERE ($start IS NULL OR e.timestamp >= $start) AND ($end IS NULL OR e.timestamp <= $end)
  OPTIONAL MATCH (source:Actor)-[:INITIATED]->(e)
  OPTIONAL MATCH (e)-[:OCCURRED_AT]->(l:Location)
  RETURN e AS event, 'targeted' AS role, source AS counterpart, l AS location
}
RETURN event.event_id AS event_id, event.event_code AS event_code,
       event.goldstein_scale AS goldstein_scale, event.avg_tone AS avg_tone,
       event.timestamp AS timestamp, event.source_url AS source_url,
       role,
       counterpart.code AS counterpart_code, counterpart.name AS counterpart_name,
       counterpart.type AS counterpart_type,
       location.name AS location_name, location.lat AS location_lat, location.long AS location_long
ORDER BY timestamp DESC
LIMIT $limit
"""

_LIST_EVENTS = """
MATCH (e:Event)
WHERE ($start IS NULL OR e.timestamp >= $start)
  AND ($end IS NULL OR e.timestamp <= $end)
  AND ($event_code IS NULL OR e.event_code = $event_code)
OPTIONAL MATCH (a1:Actor)-[:INITIATED]->(e)
OPTIONAL MATCH (e)-[:TARGETED]->(a2:Actor)
OPTIONAL MATCH (e)-[:OCCURRED_AT]->(l:Location)
RETURN e.event_id AS event_id, e.event_code AS event_code, e.goldstein_scale AS goldstein_scale,
       e.avg_tone AS avg_tone, e.timestamp AS timestamp, e.source_url AS source_url,
       a1.code AS actor1_code, a1.name AS actor1_name, a1.type AS actor1_type,
       a2.code AS actor2_code, a2.name AS actor2_name, a2.type AS actor2_type,
       l.name AS location_name, l.lat AS location_lat, l.long AS location_long
ORDER BY e.timestamp DESC
LIMIT $limit
"""

_ACTIVE_ACTORS = """
MATCH (a:Actor)
CALL (a) {
  MATCH (a)-[:INITIATED]->(e:Event)
  WHERE e.timestamp >= $start AND e.timestamp < $end
  RETURN e
  UNION
  MATCH (e:Event)-[:TARGETED]->(a)
  WHERE e.timestamp >= $start AND e.timestamp < $end
  RETURN e
}
WITH a, count(e) AS event_count
WHERE event_count >= $min_events
RETURN a.code AS code, event_count
ORDER BY event_count DESC
"""

_GET_EVENT = """
MATCH (e:Event {event_id: $event_id})
OPTIONAL MATCH (a1:Actor)-[:INITIATED]->(e)
OPTIONAL MATCH (e)-[:TARGETED]->(a2:Actor)
OPTIONAL MATCH (e)-[:OCCURRED_AT]->(l:Location)
RETURN e.event_id AS event_id, e.event_code AS event_code, e.goldstein_scale AS goldstein_scale,
       e.avg_tone AS avg_tone, e.timestamp AS timestamp, e.source_url AS source_url,
       a1.code AS actor1_code, a1.name AS actor1_name, a1.type AS actor1_type,
       a2.code AS actor2_code, a2.name AS actor2_name, a2.type AS actor2_type,
       l.name AS location_name, l.lat AS location_lat, l.long AS location_long
"""

_GET_UNRESOLVED_ACTORS = """
MATCH (a:Actor)
WHERE a.resolved_at IS NULL
RETURN a.code AS code, a.name AS name
"""

_MARK_ACTORS_RESOLVED = """
UNWIND $codes AS code
MATCH (a:Actor {code: code})
SET a.resolved_at = $resolved_at
"""

_LINK_SAME_AS = """
UNWIND $links AS link
MATCH (a:Actor {code: link.code})
MATCH (canonical:Actor {code: link.canonical_code})
MERGE (a)-[r:SAME_AS]->(canonical)
SET r.confidence = link.confidence, r.rationale = link.rationale
"""


async def upsert_actors(client: Neo4jClient, actors: list[dict]) -> None:
    await client.execute_write(_UPSERT_ACTORS, actors=actors)


async def upsert_locations(client: Neo4jClient, locations: list[dict]) -> None:
    await client.execute_write(_UPSERT_LOCATIONS, locations=locations)


async def upsert_events(client: Neo4jClient, events: list[dict]) -> None:
    await client.execute_write(_UPSERT_EVENTS, events=events)


async def link_initiated(client: Neo4jClient, links: list[dict]) -> None:
    await client.execute_write(_LINK_INITIATED, links=links)


async def link_targeted(client: Neo4jClient, links: list[dict]) -> None:
    await client.execute_write(_LINK_TARGETED, links=links)


async def link_occurred_at(client: Neo4jClient, links: list[dict]) -> None:
    await client.execute_write(_LINK_OCCURRED_AT, links=links)


async def get_actor(client: Neo4jClient, code: str) -> dict | None:
    rows = await client.execute_read(_GET_ACTOR, code=code)
    return rows[0] if rows else None


async def get_actor_events(
    client: Neo4jClient,
    code: str,
    start: datetime | None,
    end: datetime | None,
    limit: int,
) -> list[dict]:
    return await client.execute_read(_ACTOR_EVENTS, code=code, start=start, end=end, limit=limit)


async def list_events(
    client: Neo4jClient,
    start: datetime | None,
    end: datetime | None,
    event_code: str | None,
    limit: int,
) -> list[dict]:
    return await client.execute_read(
        _LIST_EVENTS, start=start, end=end, event_code=event_code, limit=limit
    )


async def get_event(client: Neo4jClient, event_id: str) -> dict | None:
    rows = await client.execute_read(_GET_EVENT, event_id=event_id)
    return rows[0] if rows else None


async def get_unresolved_actors(client: Neo4jClient) -> list[dict]:
    return await client.execute_read(_GET_UNRESOLVED_ACTORS)


async def mark_actors_resolved(client: Neo4jClient, codes: list[str], resolved_at: datetime) -> None:
    await client.execute_write(_MARK_ACTORS_RESOLVED, codes=codes, resolved_at=resolved_at)


async def link_same_as(client: Neo4jClient, links: list[dict]) -> None:
    await client.execute_write(_LINK_SAME_AS, links=links)


async def get_active_actors(
    client: Neo4jClient, start: datetime, end: datetime, min_events: int
) -> list[dict]:
    return await client.execute_read(_ACTIVE_ACTORS, start=start, end=end, min_events=min_events)
