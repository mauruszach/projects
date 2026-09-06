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
python scripts/train_forecast_baseline.py --day 2026-09-05              # backtest the forecasting baseline
python scripts/schedule_ingest.py                                       # ingest the latest completed 15-min GDELT window
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
Phase 5 complete: forecasting baseline. `app/forecasting/features.py` computes
per-actor, per-window graph-derived features (event count, avg Goldstein scale
and its within-window trend, avg tone and its trend, degree in the recent
interaction subgraph) from the existing actor-timeline query. `app/forecasting/
model.py` wraps a plain logistic regression (interpretable via
`feature_coefficients()`) and an `evaluate()` that reports accuracy, ROC-AUC,
Brier score, and a calibration curve, plus explicit caveats when the sample
size is small or a class is missing. `scripts/train_forecast_baseline.py`
builds a sliding-window, time-ordered train/test split from one day of loaded
GDELT data and backtests the baseline.

Real backtest against a full day of live GDELT data (2026-09-05, 66,878
events, sliding 8h feature / 4h label windows, 2h step, 309 active actors):
1,683 samples, 505 held out chronologically for testing -- **73.7% accuracy,
0.731 ROC-AUC, 0.181 Brier score**, with a roughly monotonic calibration curve.
Two honest caveats on that number, beyond the standing CAMEO/Goldstein proxy
caveat baked into every `evaluate()` call: (1) the escalation label is a
*relative* drop from the feature window's own average Goldstein score, which
structurally couples the label to the `avg_goldstein` feature via mean
reversion -- part of the reported accuracy likely reflects that definitional
coupling rather than purely exogenous predictive signal; a label based on an
absolute Goldstein threshold, independent of the feature window's own average,
would be a fairer test and is a natural target for Phase 7's fuller harness.
(2) `event_count`, `tone_trend`, and `degree` (the graph-structural feature)
carried almost no weight in this single day's linear fit -- not strong
evidence either way on whether graph structure adds signal beyond the two
Goldstein/tone-derived features; that question needs more data and is squarely
Phase 7's job. The dev Neo4j instance is left empty between sessions (see
Development below) -- this backtest's data was loaded, measured, and cleared.
Remaining phases tracked in `CLAUDE.md`.

## Deployment

Designed to run as three independently hostable pieces -- a managed graph
store, a stateless API container, and a scheduled ingestion job -- with no
component holding long-running local state beyond the graph itself.

- **Graph store**: [Neo4j Aura Free](https://neo4j.com/cloud/aura-free/) (managed, no ops). A single bounded GDELT day is ~65k events / ~1.5k actors (see the Phase 5 backtest above) and comfortably fits the free tier; a multi-week backfill likely won't -- size your ingestion window to whatever tier you're on.
- **API**: containerized via the included `Dockerfile` (built and smoke-tested against the local Neo4j during development). Deployable to Render, Fly.io, or any container host. `render.yaml` is a ready-to-use [Render Blueprint](https://render.com/docs/blueprint-spec) defining the web service plus a cron-scheduled ingestion job -- check Render's current plan/pricing pages before relying on the exact `plan:`/cron-availability details, since those change independently of this repo.
- **Ingestion**: `scripts/schedule_ingest.py` pulls whatever is the latest *completed* 15-minute GDELT window and is idempotent (every write is a Cypher `MERGE`, so re-running it is safe) -- run it on a schedule (Render Cron, a GitHub Actions scheduled workflow, plain crontab) rather than inline in the API process.
- **Secrets**: `ANTHROPIC_API_KEY`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` are read from the environment only -- set them as platform secrets and never commit `.env` (it's gitignored; only `.env.example` is tracked).

**Before exposing this publicly**, be aware none of the API routes have
authentication or rate limiting yet, and the entity-resolution / brief-generation
endpoints spend real Claude API credit per call. Add both, or gate those
specific routes, before a public deploy -- otherwise anyone hitting the API
spends your API budget.

## License

MIT -- see [LICENSE](LICENSE). Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
