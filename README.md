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
python scripts/resolve_entities.py                                     # resolve ambiguous actor codes
```

## Status

Phase 1 complete: repo scaffold, Neo4j via docker-compose, FastAPI health check.
Phase 2 complete: GDELT 2.0 ingestion (download, cache, parse CAMEO rows, batch-load
into Neo4j via `scripts/backfill_gdelt.py`), verified against live GDELT data.
Phase 3 complete: graph API — actor detail, actor timeline and ego-network subgraph
(both with `start`/`end` temporal filters), and event listing/lookup with
`event_code` filtering. See `/docs` for the OpenAPI UI once the server is running.
Phase 4 complete: Claude-based entity resolution for ambiguous CAMEO actor codes
(e.g. `USA` vs. `USAGOV` vs. `USAMIL`) via `scripts/resolve_entities.py`. Candidate
clusters are grouped by shared 3-letter CAMEO base code, resolved in batched
structured-output calls to Claude, and recorded non-destructively as `SAME_AS`
relationships (never merged/deleted) with a confidence and rationale; resolved
actors are marked so repeat runs only consider new actors.
Remaining phases tracked in `CLAUDE.md`.
