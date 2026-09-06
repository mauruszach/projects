from __future__ import annotations

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
