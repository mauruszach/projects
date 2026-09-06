# CLAUDE.md — Temporal Knowledge Graph Engine for Geopolitical Event Forecasting

## Project overview

This project builds a temporal knowledge graph of global geopolitical events and uses it to forecast escalation and other event trends. Events are ingested from GDELT, structured into a graph of actors, events, and locations in Neo4j, and queried and reasoned over through a FastAPI service. Claude (Anthropic API) is used for entity resolution, subgraph summarization, and generating human-readable forecast briefs — it sits alongside the graph and a lightweight statistical forecasting model rather than replacing either.

Treat this as a rebuild from scratch. There is no existing codebase to preserve; the architecture and phasing below are the plan to implement, not a description of something already working.

## Core architecture

- **Ingestion layer**: pulls raw event data from GDELT (Event Database + GKG) on a schedule, transforms CAMEO-coded rows into the graph schema below, and writes them into Neo4j in batches.
- **Graph store**: Neo4j holds actors, events, and locations as nodes, with event timestamps as node properties (not relationship versioning) so temporal range queries stay simple. All Cypher access goes through a thin client module — no raw query strings scattered through the app.
- **API layer**: FastAPI exposes read endpoints over the graph, a forecasting endpoint, and a brief-generation endpoint. All request/response schemas are pydantic models.
- **Forecasting module**: derives graph-based features per actor or actor-pair (recent event frequency, average Goldstein scale, tone trend, degree/centrality in the recent-interaction subgraph) and feeds them into a simple, explainable baseline model (start with logistic regression or gradient-boosted trees — not a deep model; the interesting question here is whether graph structure carries signal at all, and a simple model makes that legible).
- **LLM enrichment layer**: a dedicated module wraps all Claude API calls (entity disambiguation, subgraph-to-narrative summarization, forecast brief generation). LLM calls are batched and cached; never call the API per-event in a loop.

## Graph schema

Nodes: `Actor` (CAMEO actor code, resolved canonical name, type: country/org/person), `Event` (CAMEO event code, Goldstein scale, average tone, timestamp, source URL), `Location` (name, lat/long, resolved via GDELT's geo fields).

Relationships: `(Actor)-[:INITIATED]->(Event)`, `(Event)-[:TARGETED]->(Actor)`, `(Event)-[:OCCURRED_AT]->(Location)`. Temporal filtering is done by range-querying the `Event.timestamp` property, not by relationship versioning — keep this simple until there's a concrete reason to complicate it.

## Data source

Primary source is GDELT. Start with the raw daily/15-minute CSV exports (documented at data.gdeltproject.org) rather than the BigQuery public dataset, since it avoids a GCP billing dependency for local development; BigQuery access can be added later for large historical backfills if needed. Scope the initial backfill to a specific date range and/or region rather than attempting a full historical load — GDELT's full history is enormous and not necessary to validate the pipeline.

## Forecasting task

The primary predictive task is event forecasting / early warning: given an actor or actor-pair's recent graph-derived features, predict the likelihood or direction of escalation over a defined future horizon (for example, a worsening Goldstein-scale trend, or onset of a conflict-coded event type). Be explicit in code and docs that CAMEO event codes and Goldstein scale are a noisy, imperfect proxy for real-world escalation — the evaluation section of the write-up should report this honestly rather than overstating forecast accuracy.

## Repository structure

```
temporal-kg-engine/
  app/
    main.py
    api/
      routes_events.py
      routes_graph.py
      routes_forecast.py
      routes_brief.py
    ingestion/
      gdelt_client.py
      gdelt_transform.py
      loader.py
    graph/
      schema.py
      queries.py
      client.py
    forecasting/
      features.py
      model.py
    llm/
      claude_client.py
      entity_resolution.py
      summarization.py
      prompts/
    core/
      config.py
      logging.py
  scripts/
    backfill_gdelt.py
    schedule_ingest.py
  tests/
  docker-compose.yml
  pyproject.toml
  README.md
```

## Environment and setup

Required environment variables: `ANTHROPIC_API_KEY`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `GDELT_DATA_DIR` (local cache path for downloaded GDELT files). `docker-compose.yml` should bring up a local Neo4j instance for development. Use `uvicorn app.main:app --reload` for local API development and a separate scheduled script (`scripts/schedule_ingest.py`) for ingestion — do not run ingestion inline inside API request handlers.

## Development commands

- `docker-compose up -d` — start local Neo4j
- `uvicorn app.main:app --reload` — run the API locally
- `python scripts/backfill_gdelt.py --start 2024-01-01 --end 2024-01-31` — backfill a date range
- `pytest` — run tests

## Phased build plan

1. Scaffold the repo, get Neo4j running via docker-compose, and a FastAPI health check endpoint responding.
2. Implement GDELT ingestion for a small date range: download, transform CAMEO rows into the graph schema, load into Neo4j, and verify the result with direct Cypher queries.
3. Build the graph API: subgraph queries around an actor, actor timelines, temporal range filters.
4. Add the Claude-based entity resolution pass for ambiguous or duplicate CAMEO actor codes.
5. Build the forecasting baseline: graph-derived features plus a simple model, backtested against historical GDELT data with an honest accuracy/calibration report.
6. Add the LLM narrative brief endpoint that combines a forecast result with its supporting subgraph into a readable, cited summary.
7. Build an evaluation/backtesting harness that checks forecast outputs against what actually happened historically, and report calibration, not just point accuracy.

## Coding conventions

Python 3.11+, full type hints, pydantic models for every API boundary, async FastAPI route handlers, parametrized Cypher queries only (never string-interpolate values into a query), structured logging, and a retry/backoff wrapper around every Claude API call. Keep the forecasting model simple and interpretable by default — this is a research-adjacent system where explaining *why* a forecast was made matters as much as the forecast itself.

## Testing

Unit tests for the GDELT transform logic (given a sample raw row, assert the expected graph write), integration tests against a disposable test Neo4j instance, and API tests via FastAPI's TestClient. Mock the Claude API in tests rather than making live calls.

## Known risks and open questions to flag, not silently resolve

GDELT volume makes a full historical load impractical — the initial scope must be a bounded date range and region. CAMEO/Goldstein signal quality is a real limitation on forecast credibility and should be reported as such. The choice to model time as a plain node property rather than a versioned/temporal graph structure is a simplifying decision made up front — revisit only if a concrete query pattern actually requires it. Claude API cost at scale is a real constraint; batch and cache enrichment and brief generation aggressively rather than calling per-event.
