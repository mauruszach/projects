# Temporal Knowledge Graph Engine for Geopolitical Event Forecasting

Next.js interface for the temporal knowledge graph engine.

Run `npm install` then `npm run dev` from this directory. Open http://localhost:3000.

The default study contains synthetic events, explicitly labeled throughout. No source articles or forecast probabilities are fabricated. Actor selection, time playback, event filtering, field/score switching, and event inspection all work locally.

To use project records, start the FastAPI service on port 8000 and load a bounded dataset. Choose **Connect to project data**. The Next.js server proxies `/events?limit=500`, so no browser CORS configuration is needed. Override the server address with `GDELT_API_URL` in `.env.local`. The display is a sample, not an exhaustive graph.

Chat uses a visitor-supplied Anthropic key held only in page memory, with no server-key fallback. Questions and the bounded event snapshot are sent through the request-scoped server wrapper to Anthropic. It supplies deterministic descriptive statistics and prompts for explicit strategic assumptions, conditional scenarios, and event-ID citations. There is no live web search or connected forecasting model; demo answers are synthetic scenarios. The default model is claude-sonnet-4-6 (override with ANTHROPIC_CHAT_MODEL).

Node selection highlights its connected neighborhood; only the explicit time/type controls filter the graph.

Mocked chat tests: `node --test tests/*.test.mjs`. No paid API calls are made by tests.

Validation: `npm run build`.

Identical chat requests are cached in server memory for five minutes (maximum 64 responses), scoped to a salted key fingerprint. Raw keys are not retained in the cache. Model reference: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions

## Operations workspace

Light blue/black graph workspace with stable node positions, curved relationship links, an event ledger, node inspector, and agent activity log.

- **Feed watcher** polls the existing FastAPI event endpoint every 15 seconds while enabled. It requires the backend and a separately scheduled ingestion job; it does not fetch news itself. New records replace the bounded 500-record snapshot. Failures retain the last good dataset and show an error.
- **Run simulation** executes local rule-based scenario agents every 2.5 seconds, advancing hypothetical time by 15 minutes per step. Choose cooperation, escalation, or alternating branches. Pausing retains nodes; clearing deletes only local hypothetical branches. Runs cap at 50 steps. These are not autonomous LLM agents or calibrated forecasts.
- Simulated events have explicit provenance, dashed links, parent event IDs, no fabricated source links, and a rule explanation. They are excluded from evidence statistics and chat context.
- The default sandbox includes 144 synthetic events and 36 actors of multiple types. All interactions are fictional.

Run all local tests with `node --test tests/*.test.mjs`.
