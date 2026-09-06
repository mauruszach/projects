from __future__ import annotations

from typing import TypeVar

import anthropic
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import get_settings

DEFAULT_MODEL = "claude-opus-5"

T = TypeVar("T", bound=BaseModel)

_RETRYABLE_ERRORS = (
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
    anthropic.InternalServerError,
)


class ClaudeClient:
    def __init__(self, api_key: str | None = None, model: str = DEFAULT_MODEL) -> None:
        settings = get_settings()
        self._client = anthropic.AsyncAnthropic(api_key=api_key or settings.anthropic_api_key)
        self._model = model

    @retry(
        retry=retry_if_exception_type(_RETRYABLE_ERRORS),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    async def parse(
        self, *, system: str, user_content: str, output_format: type[T], max_tokens: int = 4096
    ) -> T:
        response = await self._client.messages.parse(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
            output_format=output_format,
        )
        return response.parsed_output

    async def close(self) -> None:
        await self._client.close()
