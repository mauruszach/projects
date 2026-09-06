from __future__ import annotations

import argparse
import asyncio

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.graph.client import Neo4jClient
from app.llm.claude_client import ClaudeClient
from app.llm.entity_resolution import resolve_entities

logger = get_logger(__name__)


async def run() -> None:
    settings = get_settings()
    client = Neo4jClient(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    llm = ClaudeClient()

    total = await resolve_entities(client, llm)
    logger.info("resolve_entities_complete", actors_considered=total)

    await llm.close()
    await client.close()


def main() -> None:
    configure_logging()
    argparse.ArgumentParser(
        description="Resolve ambiguous/duplicate CAMEO actor codes via Claude"
    ).parse_args()
    asyncio.run(run())


if __name__ == "__main__":
    main()
