import pytest
from fastapi import HTTPException

from app.api.deps import get_llm_client, require_anthropic_api_key


async def test_require_anthropic_api_key_rejects_missing_header() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await require_anthropic_api_key(x_anthropic_api_key=None)
    assert exc_info.value.status_code == 401
    assert "your own" in exc_info.value.detail.lower()


async def test_require_anthropic_api_key_passes_through_header() -> None:
    result = await require_anthropic_api_key(x_anthropic_api_key="sk-ant-caller-key")
    assert result == "sk-ant-caller-key"


async def test_get_llm_client_builds_client_from_caller_key_and_closes_it() -> None:
    generator = get_llm_client(api_key="sk-ant-caller-key")
    client = await generator.__anext__()
    assert client._model == "claude-opus-5"

    with pytest.raises(StopAsyncIteration):
        await generator.__anext__()
