from __future__ import annotations

import io
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

GDELT_BASE_URL = "http://data.gdeltproject.org/gdeltv2"
INTERVAL_MINUTES = 15


def iter_timestamps(start: datetime, end: datetime) -> list[datetime]:
    floored_minute = (start.minute // INTERVAL_MINUTES) * INTERVAL_MINUTES
    current = start.replace(minute=floored_minute, second=0, microsecond=0)
    if current < start:
        current += timedelta(minutes=INTERVAL_MINUTES)
    timestamps = []
    while current <= end:
        timestamps.append(current)
        current += timedelta(minutes=INTERVAL_MINUTES)
    return timestamps


def _file_url(timestamp: datetime) -> str:
    return f"{GDELT_BASE_URL}/{timestamp:%Y%m%d%H%M%S}.export.CSV.zip"


async def fetch_event_lines(
    http_client: httpx.AsyncClient, timestamp: datetime, cache_dir: Path
) -> list[str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / f"{timestamp:%Y%m%d%H%M%S}.export.CSV.zip"

    if zip_path.exists():
        raw = zip_path.read_bytes()
    else:
        url = _file_url(timestamp)
        response = await http_client.get(url, timeout=30.0)
        if response.status_code == 404:
            logger.warning("gdelt_file_not_found", url=url)
            return []
        response.raise_for_status()
        raw = response.content
        zip_path.write_bytes(raw)

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        member = zf.namelist()[0]
        with zf.open(member) as f:
            text = f.read().decode("utf-8", errors="replace")
    return text.splitlines()


async def fetch_events_range(
    start: datetime, end: datetime, cache_dir: Path
) -> AsyncIterator[str]:
    async with httpx.AsyncClient(follow_redirects=True) as http_client:
        for timestamp in iter_timestamps(start, end):
            lines = await fetch_event_lines(http_client, timestamp, cache_dir)
            logger.info("gdelt_file_fetched", timestamp=timestamp.isoformat(), rows=len(lines))
            for line in lines:
                yield line
