# Contributing

Thanks for your interest in contributing.

## Development setup

See the Setup section in `README.md`. In short: `pip install -e ".[dev]"`,
`docker-compose up -d` for a local Neo4j, `cp .env.example .env`.

## Running tests

```bash
pytest
```

Integration tests talk to the local Neo4j from `docker-compose up -d` and
skip automatically if it isn't reachable. Claude API calls are mocked in
tests -- no `ANTHROPIC_API_KEY` is required to run the suite. CI runs the
same suite against a disposable Neo4j service container (see
`.github/workflows/ci.yml`).

## Pull requests

- Keep changes scoped; add or update tests for new behavior.
- Run `pytest` before opening a PR.
- If you're touching ingestion, forecasting, or the LLM layer, read the
  "Known risks and open questions" section of `CLAUDE.md` first -- several
  design choices there (bounded backfills, Goldstein-as-proxy, non-versioned
  time) are deliberate simplifications, not oversights, and PRs should say
  explicitly when they're revisiting one rather than working around it.
