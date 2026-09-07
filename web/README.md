# Temporal Knowledge Graph Engine for Geopolitical Event Forecasting

Next.js research workspace with Helvetica typography, an interactive knowledge graph, explicit visitor-key setup, inspectable payoff matrices, and a detailed How it works guide. The workspace has no chatbot UI.

## Local preview

Run `npm install` then `npm run dev` from this directory. Open http://127.0.0.1:3000.

The feed watcher always polls `/api/events` every 15 seconds. This proxies the FastAPI `/events?limit=500` endpoint on port 8000; override with `GDELT_API_URL`. Run ingestion separately. An unavailable backend retains the last successful snapshot, or the clearly labeled synthetic demo when none has loaded.

## Simulation

1. Enter a visitor-owned Anthropic key. It stays in page memory until cleared or reloaded and is forwarded through the application server for model requests. No operator-key fallback is used.
2. Choose a starting event with two distinct actors and a scenario hint.
3. Run 1, 5, 10, or 50 steps; one is the default. Each step requests a structured Claude matrix and hypothetical event. Automatic retries can issue additional requests. Identical requests may reuse a five-minute, key-isolated response cache.

The run snapshots evidence dated at or before its starting event. Up to 12 recent related events form model context. Later generated steps may enter this context with simulated provenance. New feed records do not change a run's fixed evidence. Each hypothetical step preserves the original actor ordering and advances its timestamp 15 minutes for ordering, not a timing prediction.

The matrix labels both players, both action axes, the model's selected outcome, and independently computed pure-strategy Nash cells. This numerical check does not validate the model's assumed payoffs or solve mixed strategies. No calibrated forecast probabilities are displayed. Simulated events are excluded from evidence statistics and are not saved to Neo4j.

Stopping finishes the in-flight request and retains its result before preventing the next step. Reloading loses local scenarios and the key; it cannot reverse charges for requests already sent.

The model defaults to `claude-sonnet-4-6`, configurable via `ANTHROPIC_CHAT_MODEL`. This simulation does not search the web. The Python forecasting/evaluation path is separate.

## Validation

`node --test tests/*.test.mjs` runs local tests, including transport mocks and independent equilibrium examples. No paid API calls are made.

`npm run build` checks the Next.js build and TypeScript.
