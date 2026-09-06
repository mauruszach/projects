from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, Header, HTTPException, Request

from app.graph.client import Neo4jClient
from app.llm.claude_client import ClaudeClient


def get_graph_client(request: Request) -> Neo4jClient:
    return request.app.state.neo4j_client


async def require_anthropic_api_key(
    x_anthropic_api_key: str | None = Header(default=None, alias="X-Anthropic-Api-Key"),
) -> str:
    # Bring-your-own-key by default: the server holds no Anthropic key of its own.
    if not x_anthropic_api_key:
        raise HTTPException(
            status_code=401,
            detail=(
                "This endpoint calls the Anthropic API on your behalf and does not use a "
                "server-side key. Supply your own Anthropic API key in the "
                "X-Anthropic-Api-Key header."
            ),
        )
    return x_anthropic_api_key


async def get_llm_client(
    api_key: str = Depends(require_anthropic_api_key),
) -> AsyncIterator[ClaudeClient]:
    client = ClaudeClient(api_key=api_key)
    try:
        yield client
    finally:
        await client.close()
