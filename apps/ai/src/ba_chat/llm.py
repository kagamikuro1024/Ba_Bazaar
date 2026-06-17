"""DeepSeek streaming + JSON-mode helpers.

Mirrors the Go `llm_client.go` discipline:
  * `temperature=0` for structured calls.
  * `response_format=json_object` for schema-locked replies.
  * Server-Sent Events streaming for prose nodes so the UI can display tokens
    as they arrive.

The module is deliberately small — the chat agent should not contain a
mini OpenAI client. We expose two primitives and let the nodes compose them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from collections.abc import AsyncIterator
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from ba_chat.config import Settings, get_settings

log = logging.getLogger(__name__)


class LLMUnavailable(RuntimeError):
    """Raised when the LLM cannot be used (no key, network failure, bad JSON)."""


# Per-call retry budget for structured extraction nodes. The graph-level
# RetryPolicy already retries the *node*, but we want a tighter inner loop on
# the LLM call itself so a single transient DeepSeek hiccup (timeout, 5xx,
# malformed JSON) doesn't immediately drop us into the deterministic fallback.
#
# Tunable via env vars so ops can dial it without redeploying code:
#   BA_CHAT_LLM_MAX_ATTEMPTS  default 4
#   BA_CHAT_LLM_BACKOFF_BASE  default 0.5  (seconds)
#   BA_CHAT_LLM_BACKOFF_MAX   default 6.0  (seconds)
def _retry_budget() -> tuple[int, float, float]:
    try:
        attempts = max(1, int(os.getenv("BA_CHAT_LLM_MAX_ATTEMPTS", "4")))
    except ValueError:
        attempts = 4
    try:
        base = max(0.0, float(os.getenv("BA_CHAT_LLM_BACKOFF_BASE", "0.5")))
    except ValueError:
        base = 0.5
    try:
        cap = max(base, float(os.getenv("BA_CHAT_LLM_BACKOFF_MAX", "6.0")))
    except ValueError:
        cap = 6.0
    return attempts, base, cap


class ChatMessage(BaseModel):
    role: str
    content: str


T = TypeVar("T", bound=BaseModel)


async def stream_chat(
    messages: list[ChatMessage],
    *,
    temperature: float = 0.2,
    settings: Settings | None = None,
) -> AsyncIterator[str]:
    """Stream a chat completion as text deltas.

    Yields plain text fragments. The caller is responsible for re-assembling
    the final message and persisting it to the graph state.
    """

    settings = settings or get_settings()
    if not settings.has_llm:
        raise LLMUnavailable("DEEPSEEK_API_KEY is not configured")

    payload: dict[str, Any] = {
        "model": settings.deepseek_model,
        "messages": [m.model_dump() for m in messages],
        "temperature": temperature,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(settings.deepseek_timeout_seconds, connect=10.0)
    url = f"{settings.deepseek_base_url}/v1/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code >= 300:
                    body = await response.aread()
                    raise LLMUnavailable(
                        f"deepseek status {response.status_code}: {body[:200]!r}"
                    )
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    chunk = line.removeprefix("data:").strip()
                    if not chunk or chunk == "[DONE]":
                        continue
                    try:
                        event = json.loads(chunk)
                    except json.JSONDecodeError:
                        log.warning("non-JSON SSE chunk: %r", chunk[:120])
                        continue
                    delta = (
                        event.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content")
                    )
                    if delta:
                        yield delta
    except httpx.HTTPError as exc:
        raise LLMUnavailable(f"deepseek request failed: {exc}") from exc


async def call_json(
    *,
    system: str,
    user: str,
    schema: type[T],
    temperature: float = 0.0,
    settings: Settings | None = None,
) -> T:
    """Run a structured JSON-mode call and return a validated Pydantic model.

    Falls back to LLMUnavailable when the LLM is unreachable or returns
    something that doesn't validate. Callers handle the fallback path.
    """

    settings = settings or get_settings()
    if not settings.has_llm:
        raise LLMUnavailable("DEEPSEEK_API_KEY is not configured")

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(settings.deepseek_timeout_seconds, connect=10.0)
    url = f"{settings.deepseek_base_url}/v1/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise LLMUnavailable(f"deepseek request failed: {exc}") from exc

    if response.status_code >= 300:
        raise LLMUnavailable(
            f"deepseek status {response.status_code}: {response.text[:200]}"
        )

    try:
        choices = response.json()["choices"]
        content = choices[0]["message"]["content"].strip()
        data = json.loads(_strip_fence(content))
        return schema.model_validate(data)
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
        raise LLMUnavailable(f"deepseek returned invalid JSON: {exc}") from exc


async def call_json_with_retry(
    *,
    system: str,
    user: str,
    schema: type[T],
    temperature: float = 0.0,
    settings: Settings | None = None,
    node_name: str = "llm",
) -> T:
    """Call ``call_json`` with bounded exponential backoff + jitter.

    Use this from extraction nodes that should keep trying to pull info out
    of a flaky LLM rather than falling through to a deterministic path on
    the first hiccup. The caller is responsible for the final fallback when
    this helper exhausts its budget and re-raises ``LLMUnavailable``.

    Skips retry entirely when no key is configured — that's a permanent
    misconfiguration, not a transient blip, and looping wastes time in
    offline / CI runs.
    """

    settings = settings or get_settings()
    if not settings.has_llm:
        raise LLMUnavailable("DEEPSEEK_API_KEY is not configured")

    max_attempts, base, cap = _retry_budget()
    last_exc: LLMUnavailable | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await call_json(
                system=system,
                user=user,
                schema=schema,
                temperature=temperature,
                settings=settings,
            )
        except LLMUnavailable as exc:
            last_exc = exc
            if attempt >= max_attempts:
                log.warning(
                    "%s: LLM extraction failed after %d attempt(s): %s",
                    node_name,
                    attempt,
                    exc,
                )
                break
            backoff = min(base * (2 ** (attempt - 1)), cap)
            # Full jitter — keeps concurrent retries from synchronising.
            backoff = random.uniform(0, backoff) if backoff > 0 else 0
            log.info(
                "%s: LLM attempt %d/%d failed (%s) — retrying in %.2fs",
                node_name,
                attempt,
                max_attempts,
                exc,
                backoff,
            )
            if backoff > 0:
                await asyncio.sleep(backoff)
    assert last_exc is not None
    raise last_exc


def _strip_fence(content: str) -> str:
    """DeepSeek occasionally wraps JSON in ``` fences even with json_object mode."""

    text = content.strip()
    if text.startswith("```"):
        # drop the opening fence (and an optional language tag)
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        text = text.removesuffix("```").strip()
    return text
