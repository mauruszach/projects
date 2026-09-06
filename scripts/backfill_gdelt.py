from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.graph.client import Neo4jClient
from app.graph.schema import ensure_constraints
from app.ingestion.gdelt_client import fetch_events_range
from app.ingestion.gdelt_transform import parse_line
from app.ingestion.loader import load_events

logger = get_logger(__name__)

BATCH_SIZE = 500
LARGE_RANGE_WARNING_THRESHOLD = 500  # ~5 days at 15-min GDELT intervals


def _parse_dt(value: str) -> datetime:
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Unrecognized datetime format: {value!r} (use YYYY-MM-DD or YYYY-MM-DDTHH:MM)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill GDELT events into Neo4j")
    parser.add_argument("--start", required=True, help="Start datetime (UTC), YYYY-MM-DD[THH:MM]")
    parser.add_argument("--end", required=True, help="End datetime (UTC), YYYY-MM-DD[THH:MM]")
    return parser.parse_args()


async def run(start: datetime, end: datetime) -> None:
    settings = get_settings()
    cache_dir = Path(settings.gdelt_data_dir)
    client = Neo4jClient(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)

    await ensure_constraints(client)

    batch: list = []
    total_loaded = 0
    total_skipped = 0

    async for line in fetch_events_range(start, end, cache_dir):
        record = parse_line(line)
        if record is None:
            total_skipped += 1
            continue
        batch.append(record)
        if len(batch) >= BATCH_SIZE:
            total_loaded += await load_events(client, batch)
            logger.info("batch_loaded", total_loaded=total_loaded)
            batch = []

    if batch:
        total_loaded += await load_events(client, batch)

    logger.info("backfill_complete", total_loaded=total_loaded, total_skipped=total_skipped)
    await client.close()


def main() -> None:
    configure_logging()
    args = parse_args()
    start = _parse_dt(args.start)
    end = _parse_dt(args.end)
    if end < start:
        raise SystemExit("--end must be after --start")

    estimated_files = int((end - start).total_seconds() // (15 * 60)) + 1
    if estimated_files > LARGE_RANGE_WARNING_THRESHOLD:
        logger.warning(
            "large_backfill_range",
            estimated_files=estimated_files,
            hint="GDELT publishes every 15 minutes; consider narrowing --start/--end for local validation",
        )

    asyncio.run(run(start, end))


if __name__ == "__main__":
    main()
