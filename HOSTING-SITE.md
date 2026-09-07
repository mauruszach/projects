# Combined research site

One public origin serves the project chooser at `/`, Predictor at `/predictor`, and Polymarket at `/polymarket` (including `/polymarket/how-it-works`). Predictor's existing `/api/events` and `/api/agent-step` remain on the main service. Polymarket's assets and refresh API are isolated under `/polymarket` and forwarded to its private Node process on port 3107.

The original `polymarket_spd` checkout is unchanged. Its deployable source snapshot lives in `projects/polymarket`; update that snapshot explicitly when integrating future changes.

## Local development

Install dependencies in `web` and `projects/polymarket/web`. Supply a Python executable with `projects/polymarket/requirements-hosting.txt` installed using `POLYMARKET_PYTHON`. Start both apps with `node scripts/serve-site.mjs --dev`, then open http://127.0.0.1:3000. Stop any previous servers using these two ports first.

## Container hosting

Build from the repository root with `docker build -f Dockerfile.site -t research-site .`, or run `docker compose -f compose.site.yaml up --build -d`. Run a single replica exposing port 3000. The launcher starts both Node apps and shuts down the container if either fails. Health check `/api/health` verifies both Node services without starting data refresh jobs or calling Anthropic. It intentionally does not require an optional GDELT backend. Verify `/predictor`, `/polymarket` and `/polymarket/how-it-works` as deployment smoke checks.

Choose a persistent container host with outbound HTTPS and enough memory for the Python correlation pipeline. This complete application is not a static site or Cloudflare Worker: Polymarket refresh launches a Python subprocess and keeps jobs in Node process memory. Do not scale to multiple replicas until its job registry is shared. Add host-level request throttling before public deployment.

Set `GDELT_API_URL` to the hosted Predictor FastAPI service. Neo4j and scheduled GDELT ingestion remain separate backend services, as configured in the existing backend deployment files. Without that backend, Predictor explicitly shows demo data and keeps retrying. Do not configure a shared Anthropic key: visitors supply their own.

The container includes Polymarket's Python dependencies and its initial graph/price snapshot. Visiting Polymarket starts or joins a refresh; failures retain the labeled fallback. No model key is required for that project.

Public hosting and a domain have not been selected yet. Before publication, build and smoke-test the container on the chosen host and verify the live refresh reaches completion. Local frontend checks do not certify the remote data pipeline.

## Render setup

Run `node scripts/check-site.mjs https://YOUR-SITE` after deployment for route, health and missing-key checks. This script does not start refresh jobs or make paid model requests.

1. Push the complete combined repository to GitHub or another Git provider supported by Render. Include `projects/polymarket`, both package lockfiles, and the bundled graph/price JSON. Exclude `.env`, virtual environments, dependencies and local caches.
2. Connect that repository to a Render Blueprint using `render-site.yaml`. Alternatively create a Docker Web Service with repository-root build context, Dockerfile `Dockerfile.site`, health check `/api/health`, and port 3000. Do not choose just the `web` subdirectory as the build context.
3. Select a paid, persistent instance with sufficient memory for the correlation job; keep one instance. Start with at least 2 GB as a provisional sizing estimate and measure peak memory during the first full refresh before opening the site broadly. This has not been load-tested.
4. Deploy and open the supplied HTTPS URL. Verify both apps, the explanation pages, and a complete Polymarket refresh. The container build installs the Python dependencies automatically. Your laptop does not need to stay online.
5. For recorded Predictor events, deploy the existing FastAPI service and ingestion job from `render.yaml`, provision a hosted Neo4j database, and configure `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` and `GDELT_DATA_DIR` for both Python services. Set the website's `GDELT_API_URL` to the reachable API URL. Scope the initial historical backfill before running it.
6. Optionally connect your custom domain through the host's dashboard and apply the DNS records it supplies. The provider URL works without buying a domain.

No API key is needed to deploy the graph interfaces. Predictor visitors need their own Anthropic account/key only to run its model-based simulations. Infrastructure hosting and Neo4j costs remain the operator's responsibility.

## If using Vercel instead

Next.js is the application framework, not the hosting account. The current full container can run on a Node/Docker host. A Vercel deployment needs a separate persistent Polymarket service because its refresh launches Python and keeps job state in memory. The current combined launcher and local proxy address are designed for the container topology; splitting these services requires a separate integration and deployment configuration, not simply importing the `web` folder into Vercel.

## Verification performed

The production Docker image was built from clean dependencies and run locally. All six route/health checks and the missing-key rejection check passed against that container. Python analysis dependencies and the copied pipeline package imported successfully. The temporary container was then stopped; the normal development preview remains separate. A complete external Polymarket refresh, paid Anthropic call, hosted Neo4j connection, production load test, and provider deployment were not part of this validation.
