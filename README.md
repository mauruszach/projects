# Projects

A static GitHub Pages showcase for two research projects, with instructions for running the interactive environments on your own computer. The public website runs no servers, data jobs or paid model calls.

**[Project showcase](https://mauruszach.github.io/projects/)** · [Local setup instructions](https://mauruszach.github.io/projects/#setup)

- **Temporal Knowledge Graph Engine for Geopolitical Event Forecasting** — event relationships and hypothetical strategic payoff matrices.
- **Polymarket Cross-Market Correlation Graph and Shock Simulator** — market relationships, price histories, and exploratory shock propagation.

The public site is plain HTML/CSS in `docs`, published by `.github/workflows/pages.yml`. In repository Settings → Pages, select GitHub Actions as the publishing source. The Next.js apps remain available locally in `web` and `projects/polymarket/web`; visitors bring their own Anthropic key only if they run Predictor simulations locally. [HOSTING-SITE.md](HOSTING-SITE.md) preserves the optional container-hosting instructions, which are not required for GitHub Pages.

## Temporal Knowledge Graph Engine

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
- **Ingestion**: `scripts/schedule_ingest.py` pulls whatever is the latest *completed* 15-minute GDELT window and is idempotent (every write is a Cypher `MERGE`, so re-running it is safe) -- run it on a schedule (Render Cron, a GitHub Actions scheduled workflow, plain crontab) rather than inline in the API process. It doesn't call Claude, so it only needs the `NEO4J_*` secrets.
- **Secrets**: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` are read from the environment and set as platform secrets; never commit `.env` (it's gitignored -- only `.env.example` is tracked).

### Bring your own Anthropic key

The hosted API holds **no Anthropic API key of its own**. Any endpoint that
calls Claude requires the *caller* to supply their own key in an
`X-Anthropic-Api-Key` request header (enforced by `require_anthropic_api_key`
in `app/api/deps.py`, which returns 401 if it's missing) -- a fresh
`ClaudeClient` is built from that header per request and closed when the
request finishes. This is deliberate: it means hosting this publicly never
puts the operator's own Claude spend at the mercy of other people's traffic,
and there is no `ANTHROPIC_API_KEY` for the web service in `render.yaml`.

This applies to the *public HTTP surface* only. Operator-run scripts
(`scripts/resolve_entities.py`, and any future scripts you run directly
against your own deployment) still read `ANTHROPIC_API_KEY` from your local
`.env` or shell environment, same as any other CLI tool -- BYOK is about
callers of your hosted API, not about you running your own maintenance jobs.

**Before exposing the API publicly**, note that BYOK solves the *cost*
problem but not the *abuse* problem: there is still no rate limiting, so
someone could hammer the API with their own key and run up their own bill
(their problem) or hit Neo4j hard enough to degrade service for everyone
else (your problem). Add rate limiting before a public deploy if that risk
matters to you.

## License

MIT -- see [LICENSE](LICENSE). Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
