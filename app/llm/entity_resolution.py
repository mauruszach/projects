from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.graph import queries
from app.graph.client import Neo4jClient
from app.llm.claude_client import ClaudeClient

logger = get_logger(__name__)

CLUSTER_BATCH_SIZE = 25

_SYSTEM_PROMPT = (
    "You resolve ambiguous CAMEO actor codes from the GDELT event dataset. Each "
    "cluster groups actor codes that share a 3-letter CAMEO base code (a country "
    "or organization code) with one or more composite codes appending a role "
    "suffix (e.g. USAGOV, USAMIL). Decide whether the codes in a cluster refer "
    "to the same real-world top-level actor for the purpose of a geopolitical "
    "event graph, and if so, what canonical display name best represents them. "
    "Be conservative: if the codes plausibly refer to distinct, independently "
    "trackable actors (e.g. a government versus a rebel group in the same "
    "country), mark them as not the same entity."
)


class ClusterResolution(BaseModel):
    cluster_index: int
    same_entity: bool
    canonical_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str


class ClusterResolutionBatch(BaseModel):
    resolutions: list[ClusterResolution]


def _group_candidate_clusters(actors: list[dict]) -> list[list[dict]]:
    by_prefix: dict[str, list[dict]] = defaultdict(list)
    for actor in actors:
        code = actor["code"]
        if len(code) < 3:
            continue
        by_prefix[code[:3]].append(actor)
    return [group for group in by_prefix.values() if len(group) > 1]


def _format_cluster(index: int, cluster: list[dict]) -> str:
    members = "; ".join(f"{a['code']} ({a['name']})" for a in cluster)
    return f"Cluster {index}: {members}"


async def resolve_entities(client: Neo4jClient, llm: ClaudeClient) -> int:
    actors = await queries.get_unresolved_actors(client)
    clusters = _group_candidate_clusters(actors)

    if not clusters:
        logger.info("entity_resolution_no_candidates")
        return 0

    resolved_at = datetime.now(timezone.utc)
    total_considered = 0

    for batch_start in range(0, len(clusters), CLUSTER_BATCH_SIZE):
        batch = clusters[batch_start : batch_start + CLUSTER_BATCH_SIZE]
        prompt = "\n".join(_format_cluster(i, cluster) for i, cluster in enumerate(batch))

        result = await llm.parse(
            system=_SYSTEM_PROMPT,
            user_content=(
                "Resolve each of the following actor code clusters. Return one "
                "resolution per cluster, in order, using its cluster_index.\n\n" + prompt
            ),
            output_format=ClusterResolutionBatch,
        )

        by_index = {r.cluster_index: r for r in result.resolutions}
        same_as_links: list[dict] = []
        all_codes: list[str] = []

        for i, cluster in enumerate(batch):
            all_codes.extend(a["code"] for a in cluster)
            resolution = by_index.get(i)
            if resolution is None:
                logger.warning("entity_resolution_missing_cluster", cluster_index=i)
                continue
            if not resolution.same_entity:
                continue

            canonical = min(cluster, key=lambda a: (len(a["code"]), a["code"]))
            for actor in cluster:
                if actor["code"] == canonical["code"]:
                    continue
                same_as_links.append(
                    {
                        "code": actor["code"],
                        "canonical_code": canonical["code"],
                        "confidence": resolution.confidence,
                        "rationale": resolution.rationale,
                    }
                )

        if same_as_links:
            await queries.link_same_as(client, same_as_links)
        await queries.mark_actors_resolved(client, all_codes, resolved_at)
        total_considered += len(all_codes)
        logger.info(
            "entity_resolution_batch_complete", clusters=len(batch), actors=len(all_codes)
        )

    return total_considered
