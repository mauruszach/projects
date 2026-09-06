from __future__ import annotations

from neo4j import AsyncGraphDatabase


class Neo4jClient:
    def __init__(self, uri: str, user: str, password: str) -> None:
        self._driver = AsyncGraphDatabase.driver(uri, auth=(user, password))

    async def close(self) -> None:
        await self._driver.close()

    async def execute_write(self, query: str, **params: object) -> None:
        async with self._driver.session() as session:
            async def work(tx: object) -> None:
                await tx.run(query, **params)

            await session.execute_write(work)

    async def execute_read(self, query: str, **params: object) -> list[dict]:
        async with self._driver.session() as session:
            async def work(tx: object) -> list[dict]:
                result = await tx.run(query, **params)
                return [record.data() async for record in result]

            return await session.execute_read(work)
