from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes_events import router as events_router
from app.api.routes_graph import router as graph_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.graph.client import Neo4jClient

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.neo4j_client = Neo4jClient(
        settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password
    )
    yield
    await app.state.neo4j_client.close()


app = FastAPI(title="Temporal KG Engine", version="0.1.0", lifespan=lifespan)
app.include_router(graph_router)
app.include_router(events_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
