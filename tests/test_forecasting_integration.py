from datetime import datetime, timezone

import pytest_asyncio

from app.forecasting.features import build_actor_window_sample
from app.graph.schema import ActorNode, EventNode, LocationNode, ParsedEvent
from app.ingestion.loader import load_events

ACTOR = "ZZFC_USA"
COUNTERPART = "ZZFC_RUS"
EVENT_IDS = [f"zzfc-{i}" for i in range(6)]

FEATURE_START = datetime(2024, 2, 1, 0, 0, tzinfo=timezone.utc)
FEATURE_END = datetime(2024, 2, 1, 8, 0, tzinfo=timezone.utc)
LABEL_END = datetime(2024, 2, 1, 12, 0, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def escalating_actor_events(neo4j_client):
    def _event(event_id: str, hour: int, goldstein: float) -> ParsedEvent:
        return ParsedEvent(
            event=EventNode(
                event_id=event_id,
                event_code="190",
                goldstein_scale=goldstein,
                avg_tone=-1.0,
                timestamp=FEATURE_START.replace(hour=hour),
                source_url="http://example.com",
            ),
            actor1=ActorNode(code=ACTOR, name="ZZTEST FORECAST USA", actor_type="country"),
            actor2=ActorNode(code=COUNTERPART, name="ZZTEST FORECAST RUSSIA", actor_type="country"),
            location=LocationNode(name="ZZFC Test Location", lat=0.0, long=0.0),
        )

    # Feature window [0h, 8h): calm, avg goldstein = 3.0
    # Label window [8h, 12h): escalated, avg goldstein = -2.0 (drop of 5.0 >> threshold)
    records = [
        _event(EVENT_IDS[0], 1, 3.0),
        _event(EVENT_IDS[1], 2, 3.0),
        _event(EVENT_IDS[2], 3, 3.0),
        _event(EVENT_IDS[3], 9, -2.0),
        _event(EVENT_IDS[4], 10, -2.0),
        _event(EVENT_IDS[5], 11, -2.0),
    ]
    await load_events(neo4j_client, records)

    yield

    await neo4j_client.execute_write(
        "MATCH (a:Actor) WHERE a.code IN [$a, $b] DETACH DELETE a", a=ACTOR, b=COUNTERPART
    )
    await neo4j_client.execute_write(
        "MATCH (e:Event) WHERE e.event_id IN $ids DETACH DELETE e", ids=EVENT_IDS
    )
    await neo4j_client.execute_write(
        "MATCH (l:Location {name: 'ZZFC Test Location'}) DETACH DELETE l"
    )


async def test_build_actor_window_sample_detects_escalation(
    neo4j_client, escalating_actor_events
) -> None:
    sample = await build_actor_window_sample(
        neo4j_client, ACTOR, FEATURE_START, FEATURE_END, LABEL_END, min_events=2
    )

    assert sample is not None
    features, label = sample
    assert features.event_count == 3
    assert features.avg_goldstein == 3.0
    assert label == 1


async def test_build_actor_window_sample_returns_none_below_min_events(
    neo4j_client, escalating_actor_events
) -> None:
    sample = await build_actor_window_sample(
        neo4j_client, ACTOR, FEATURE_START, FEATURE_END, LABEL_END, min_events=10
    )
    assert sample is None
