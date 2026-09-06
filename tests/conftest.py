from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.graph.client import Neo4jClient
from app.graph.schema import ActorNode, EventNode, LocationNode, ParsedEvent, ensure_constraints
from app.ingestion.loader import load_events
from app.main import app

TEST_ACTOR_A = "ZZTEST_USA"
TEST_ACTOR_B = "ZZTEST_RUS"
TEST_LOCATION = "ZZTEST Geneva, Switzerland"
TEST_EVENT_IDS = ["zztest-1", "zztest-2"]


@pytest_asyncio.fixture
async def neo4j_client():
    settings = get_settings()
    client = Neo4jClient(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    try:
        await client.execute_read("RETURN 1")
    except Exception as exc:  # noqa: BLE001 - any connectivity failure should skip, not fail
        await client.close()
        pytest.skip(f"Neo4j not reachable at {settings.neo4j_uri}: {exc}")
    await ensure_constraints(client)
    yield client
    await client.close()


@pytest_asyncio.fixture
async def seeded_events(neo4j_client: Neo4jClient):
    event1 = ParsedEvent(
        event=EventNode(
            event_id=TEST_EVENT_IDS[0],
            event_code="043",
            goldstein_scale=1.9,
            avg_tone=-2.5,
            timestamp=datetime(2024, 1, 15, 12, 0, tzinfo=timezone.utc),
            source_url="http://example.com/1",
        ),
        actor1=ActorNode(code=TEST_ACTOR_A, name="ZZTEST UNITED STATES", actor_type="country"),
        actor2=ActorNode(code=TEST_ACTOR_B, name="ZZTEST RUSSIA", actor_type="country"),
        location=LocationNode(name=TEST_LOCATION, lat=46.2, long=6.1467),
    )
    event2 = ParsedEvent(
        event=EventNode(
            event_id=TEST_EVENT_IDS[1],
            event_code="051",
            goldstein_scale=3.4,
            avg_tone=1.0,
            timestamp=datetime(2024, 1, 16, 9, 0, tzinfo=timezone.utc),
            source_url="http://example.com/2",
        ),
        actor1=ActorNode(code=TEST_ACTOR_B, name="ZZTEST RUSSIA", actor_type="country"),
        actor2=ActorNode(code=TEST_ACTOR_A, name="ZZTEST UNITED STATES", actor_type="country"),
        location=None,
    )
    await load_events(neo4j_client, [event1, event2])

    yield [event1, event2]

    await neo4j_client.execute_write(
        "MATCH (a:Actor) WHERE a.code IN $codes DETACH DELETE a",
        codes=[TEST_ACTOR_A, TEST_ACTOR_B],
    )
    await neo4j_client.execute_write(
        "MATCH (e:Event) WHERE e.event_id IN $ids DETACH DELETE e", ids=TEST_EVENT_IDS
    )
    await neo4j_client.execute_write(
        "MATCH (l:Location {name: $name}) DETACH DELETE l", name=TEST_LOCATION
    )


@pytest.fixture
def api_client(neo4j_client: Neo4jClient):
    # neo4j_client is depended on only for the connectivity-skip and constraint
    # setup; TestClient triggers the app's own lifespan, whose Neo4jClient runs
    # in TestClient's event loop and points at the same underlying database, so
    # data seeded via neo4j_client is visible through it.
    with TestClient(app) as client:
        yield client
