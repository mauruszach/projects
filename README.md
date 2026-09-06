# Temporal Knowledge Graph Engine

Temporal knowledge graph of global geopolitical events, built from GDELT, stored in Neo4j,
and used to forecast escalation trends. See `CLAUDE.md` for full architecture and phased build plan.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env   # fill in ANTHROPIC_API_KEY; NEO4J_* already point at docker-compose
docker-compose up -d   # starts Neo4j on bolt://localhost:7688 (browser UI: http://localhost:7475)
```

## Development

```bash
uvicorn app.main:app --reload   # run the API locally
pytest                          # run tests
python scripts/backfill_gdelt.py --start 2024-01-01 --end 2024-01-31   # backfill GDELT
```

## Status

Phase 1 complete: repo scaffold, Neo4j via docker-compose, FastAPI health check.
Phase 2 complete: GDELT 2.0 ingestion (download, cache, parse CAMEO rows, batch-load
into Neo4j via `scripts/backfill_gdelt.py`), verified against live GDELT data.
Remaining phases tracked in `CLAUDE.md`.
