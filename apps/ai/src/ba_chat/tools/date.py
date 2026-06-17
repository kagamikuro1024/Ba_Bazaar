"""Date context tool for booking flows."""

from __future__ import annotations

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Bangkok"


def get_today(*, timezone: str | None = None) -> date:
    """Return today's date for the booking assistant's business timezone."""

    tz_name = timezone or os.getenv("BA_CHAT_TIMEZONE", DEFAULT_TIMEZONE)
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo(DEFAULT_TIMEZONE)
    return datetime.now(tz).date()


def get_today_iso(*, timezone: str | None = None) -> str:
    return get_today(timezone=timezone).isoformat()
