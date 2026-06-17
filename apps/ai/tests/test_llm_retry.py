"""Tests for the per-call LLM retry helper.

The extraction nodes (router, extract_slots, summarize_metrics) use
`call_json_with_retry` so a single transient DeepSeek hiccup doesn't
immediately drop us into the deterministic fallback. These tests pin the
retry contract:

  * Retries until success when the LLM eventually returns valid JSON.
  * Re-raises LLMUnavailable after the budget is exhausted.
  * Skips retry entirely when no API key is configured (offline path).
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from ba_chat import llm as llm_module
from ba_chat.config import get_settings
from ba_chat.llm import LLMUnavailable, call_json_with_retry


class _Schema(BaseModel):
    value: str


@pytest.fixture
def _llm_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pretend a DeepSeek key is configured so retry is exercised."""

    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("BA_CHAT_LLM_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("BA_CHAT_LLM_BACKOFF_BASE", "0")  # instant retries in tests
    monkeypatch.setenv("BA_CHAT_LLM_BACKOFF_MAX", "0")
    get_settings.cache_clear()


async def test_retries_until_success(
    _llm_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two transient failures, then success — caller gets the parsed model."""

    calls = {"n": 0}

    async def fake_call_json(**_kwargs):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] < 3:
            raise LLMUnavailable(f"transient blip #{calls['n']}")
        return _Schema(value="ok")

    monkeypatch.setattr(llm_module, "call_json", fake_call_json)

    result = await call_json_with_retry(
        system="s", user="u", schema=_Schema, node_name="test"
    )
    assert result.value == "ok"
    assert calls["n"] == 3, "should have retried twice before succeeding"


async def test_reraises_when_budget_exhausted(
    _llm_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """All attempts fail — final LLMUnavailable bubbles up to the caller."""

    calls = {"n": 0}

    async def always_fails(**_kwargs):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        raise LLMUnavailable(f"permanent-feeling blip #{calls['n']}")

    monkeypatch.setattr(llm_module, "call_json", always_fails)

    with pytest.raises(LLMUnavailable):
        await call_json_with_retry(
            system="s", user="u", schema=_Schema, node_name="test"
        )
    assert calls["n"] == 3, "should respect BA_CHAT_LLM_MAX_ATTEMPTS"


async def test_skips_retry_when_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without DEEPSEEK_API_KEY, looping is pointless — fail fast."""

    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    get_settings.cache_clear()

    calls = {"n": 0}

    async def fake_call_json(**_kwargs):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        return _Schema(value="never")

    monkeypatch.setattr(llm_module, "call_json", fake_call_json)

    with pytest.raises(LLMUnavailable):
        await call_json_with_retry(
            system="s", user="u", schema=_Schema, node_name="test"
        )
    assert calls["n"] == 0, "must not call call_json when no key is configured"
