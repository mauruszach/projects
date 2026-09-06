from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.graph.client import Neo4jClient
from app.graph.schema import ensure_constraints
from app.ingestion.gdelt_client import INTERVAL_MINUTES, fetch_event_lines
from app.ingestion.gdelt_transform import parse_line
from app.ingestion.loader import load_events

logger = get_logger(__name__)

# GDELT files land a few minutes after the interval they cover; look one
# interval behind "now" so we don't repeatedly 404 on a file that hasn't
# been published yet.
PUBLISH_LAG_MINUTES = INTERVAL_MINUTES


def _floor_to_interval(dt: datetime) -> datetime:
    floored_minute = (dt.minute // INTERVAL_MINUTES) * INTERVAL_MINUTES
    return dt.replace(minute=floored_minute, second=0, microsecond=0)


async def run() -> None:
    settings = get_settings()
    cache_dir = Path(settings.gdelt_data_dir)
    client = Neo4jClient(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    await ensure_constraints(client)

    target = _floor_to_interval(datetime.now(timezone.utc) - timedelta(minutes=PUBLISH_LAG_MINUTES))

    async with httpx.AsyncClient(follow_redirects=True) as http_client:
        lines = await fetch_event_lines(http_client, target, cache_dir)

    batch = [record for line in lines if (record := parse_line(line)) is not None]
    total_loaded = await load_events(client, batch) if batch else 0

    logger.info("scheduled_ingest_complete", timestamp=target.isoformat(), total_loaded=total_loaded)
    await client.close()


def main() -> None:
    configure_logging()
    asyncio.run(run())


if __name__ == "__main__":
    main()
