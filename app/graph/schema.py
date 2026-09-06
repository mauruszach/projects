from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.graph.client import Neo4jClient


class ActorNode(BaseModel):
    code: str
    name: str
    actor_type: str


class LocationNode(BaseModel):
    name: str
    lat: float | None = None
    long: float | None = None


class EventNode(BaseModel):
    event_id: str
    event_code: str
    goldstein_scale: float
    avg_tone: float
    timestamp: datetime
    source_url: str


class ParsedEvent(BaseModel):
    event: EventNode
    actor1: ActorNode | None = None
    actor2: ActorNode | None = None
    location: LocationNode | None = None


_CONSTRAINTS = [
    "CREATE CONSTRAINT actor_code_unique IF NOT EXISTS FOR (a:Actor) REQUIRE a.code IS UNIQUE",
    "CREATE CONSTRAINT event_id_unique IF NOT EXISTS FOR (e:Event) REQUIRE e.event_id IS UNIQUE",
    "CREATE CONSTRAINT location_name_unique IF NOT EXISTS FOR (l:Location) REQUIRE l.name IS UNIQUE",
]


async def ensure_constraints(client: Neo4jClient) -> None:
    for statement in _CONSTRAINTS:
        await client.execute_write(statement)
