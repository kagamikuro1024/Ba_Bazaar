"""Centralised configuration for the chat agent.

All tunables come from environment variables so the same code runs in dev,
CI, and production. Keep this module small — when a setting needs more than
a literal, move it into the relevant module.

On import we look for ``.env`` files in two places (closest wins, never
overrides values already exported in the shell):
  1. ``apps/ai/.env`` — chat-specific overrides.
  2. ``apps/api/.env`` — shared with the Go API (DeepSeek key lives here).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


def _load_env_files() -> None:
    """Load nearby .env files. Existing env vars always win."""

    here = Path(__file__).resolve()
    # apps/ai/src/ba_chat/config.py → repo root is parents[4]
    repo_root = here.parents[4]
    candidates = [
        repo_root / "apps" / "ai" / ".env",
        repo_root / "apps" / "api" / ".env",
        repo_root / ".env",
    ]
    for candidate in candidates:
        if candidate.is_file():
            load_dotenv(candidate, override=False)


_load_env_files()


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    api_token: str | None
    deepseek_api_key: str | None
    deepseek_model: str
    deepseek_base_url: str
    deepseek_timeout_seconds: float
    request_timeout_seconds: float
    max_summary_bullets: int
    log_level: str

    @property
    def has_llm(self) -> bool:
        return bool(self.deepseek_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        api_base_url=os.getenv("BA_API_BASE_URL", "http://localhost:3000").rstrip("/"),
        api_token=_strip_or_none(os.getenv("BA_API_TOKEN")),
        deepseek_api_key=_strip_or_none(os.getenv("DEEPSEEK_API_KEY")),
        deepseek_model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        deepseek_base_url=os.getenv(
            "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
        ).rstrip("/"),
        deepseek_timeout_seconds=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "45")),
        request_timeout_seconds=float(os.getenv("BA_API_TIMEOUT_SECONDS", "20")),
        max_summary_bullets=int(os.getenv("BA_CHAT_MAX_BULLETS", "5")),
        log_level=os.getenv("BA_CHAT_LOG_LEVEL", "INFO").upper(),
    )


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None
