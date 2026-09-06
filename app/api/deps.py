from __future__ import annotations

from fastapi import Request

from app.graph.client import Neo4jClient


def get_graph_client(request: Request) -> Neo4jClient:
    return request.app.state.neo4j_client
