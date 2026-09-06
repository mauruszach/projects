import pytest_asyncio

from app.llm.entity_resolution import (
    ClusterResolution,
    ClusterResolutionBatch,
    _group_candidate_clusters,
    resolve_entities,
)


def test_group_candidate_clusters_by_cameo_prefix() -> None:
    actors = [
        {"code": "USA", "name": "UNITED STATES"},
        {"code": "USAGOV", "name": "UNITED STATES GOVERNMENT"},
        {"code": "USAMIL", "name": "UNITED STATES MILITARY"},
        {"code": "RUS", "name": "RUSSIA"},
    ]
    clusters = _group_candidate_clusters(actors)
    assert len(clusters) == 1
    assert {a["code"] for a in clusters[0]} == {"USA", "USAGOV", "USAMIL"}


def test_group_candidate_clusters_ignores_singletons() -> None:
    actors = [{"code": "USA", "name": "UNITED STATES"}, {"code": "RUS", "name": "RUSSIA"}]
    assert _group_candidate_clusters(actors) == []


class _FakeClaudeClient:
    def __init__(self, response: ClusterResolutionBatch) -> None:
        self._response = response
        self.calls = 0

    async def parse(self, *, system, user_content, output_format, max_tokens=4096):
        self.calls += 1
        return self._response


@pytest_asyncio.fixture
async def ambiguous_actors(neo4j_client):
    await neo4j_client.execute_write(
        "MERGE (a:Actor {code: 'ZZA'}) SET a.name = 'ZZTEST ALPHA', a.type = 'country', a.resolved_at = null"
    )
    await neo4j_client.execute_write(
        "MERGE (a:Actor {code: 'ZZAGOV'}) SET a.name = 'ZZTEST ALPHA GOVERNMENT', a.type = 'org', a.resolved_at = null"
    )
    yield
    await neo4j_client.execute_write(
        "MATCH (a:Actor) WHERE a.code IN ['ZZA', 'ZZAGOV'] DETACH DELETE a"
    )


async def test_resolve_entities_links_same_as(neo4j_client, ambiguous_actors) -> None:
    fake_llm = _FakeClaudeClient(
        ClusterResolutionBatch(
            resolutions=[
                ClusterResolution(
                    cluster_index=0,
                    same_entity=True,
                    canonical_name="Alpha",
                    confidence=0.9,
                    rationale="test",
                )
            ]
        )
    )

    total = await resolve_entities(neo4j_client, fake_llm)
    assert total == 2
    assert fake_llm.calls == 1

    rows = await neo4j_client.execute_read(
        "MATCH (a:Actor {code: 'ZZAGOV'})-[r:SAME_AS]->(c:Actor {code: 'ZZA'}) "
        "RETURN r.confidence AS confidence"
    )
    assert len(rows) == 1
    assert rows[0]["confidence"] == 0.9

    resolved = await neo4j_client.execute_read(
        "MATCH (a:Actor) WHERE a.code IN ['ZZA', 'ZZAGOV'] "
        "RETURN a.resolved_at IS NOT NULL AS resolved"
    )
    assert all(row["resolved"] for row in resolved)


async def test_resolve_entities_skips_already_resolved_actors(neo4j_client, ambiguous_actors) -> None:
    # Pre-resolve both actors; resolve_entities should find no candidates left.
    from datetime import datetime, timezone

    await neo4j_client.execute_write(
        "MATCH (a:Actor) WHERE a.code IN ['ZZA', 'ZZAGOV'] SET a.resolved_at = $now",
        now=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    fake_llm = _FakeClaudeClient(ClusterResolutionBatch(resolutions=[]))

    total = await resolve_entities(neo4j_client, fake_llm)
    assert total == 0
    assert fake_llm.calls == 0
