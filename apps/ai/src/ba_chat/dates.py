"""Deterministic date parsing for slot extraction.

The LLM should never hallucinate dates. We resolve relative phrases
(``tomorrow``, ``next week``, ``from June 20 for 5 days``) here in
Python so the agent stays grounded in the server's calendar.

Returns ISO ``YYYY-MM-DD`` strings, the format the Go API expects.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

_WEEKDAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

_MONTHS = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_FOR_DAYS = re.compile(r"for\s+(\d+)\s+days?", re.IGNORECASE)
_FOR_WEEKS = re.compile(r"for\s+(\d+)\s+weeks?", re.IGNORECASE)
_MONTH_DAY = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b",
    re.IGNORECASE,
)


def today() -> date:
    """Hook so tests can monkeypatch."""

    return date.today()


def to_iso(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def parse_relative(text: str, *, anchor: date | None = None) -> tuple[str | None, str | None]:
    """Return ``(start_iso, end_iso)`` extracted from ``text`` if possible.

    The function is deliberately permissive — it returns ``(None, None)`` when
    nothing parseable is found, leaving the LLM to fall back on ``ask_missing``.
    """

    if not text:
        return None, None
    anchor = anchor or today()
    lowered = text.lower()

    iso_matches = _ISO.findall(text)
    if len(iso_matches) >= 2:
        a = date(int(iso_matches[0][0]), int(iso_matches[0][1]), int(iso_matches[0][2]))
        b = date(int(iso_matches[1][0]), int(iso_matches[1][1]), int(iso_matches[1][2]))
        start, end = sorted((a, b))
        return to_iso(start), to_iso(end)
    if len(iso_matches) == 1:
        only = date(int(iso_matches[0][0]), int(iso_matches[0][1]), int(iso_matches[0][2]))
        end = _apply_duration(only, lowered) or only
        return to_iso(only), to_iso(end)

    # Try two "Month Day" dates (e.g. "from June 20 to June 30")
    month_matches = list(_MONTH_DAY.finditer(text))
    if len(month_matches) >= 2:
        d1 = _month_match_to_date(month_matches[0], anchor)
        d2 = _month_match_to_date(month_matches[1], anchor)
        if d1 and d2:
            start, end = sorted((d1, d2))
            return to_iso(start), to_iso(end)

    start = _parse_anchor_phrase(lowered, anchor)
    if start is None and month_matches:
        start = _month_match_to_date(month_matches[0], anchor)
    if start is None:
        return None, None
    end = _apply_duration(start, lowered) or start
    return to_iso(start), to_iso(end)


def _month_match_to_date(match: re.Match, anchor: date) -> date | None:  # type: ignore[type-arg]
    """Convert a _MONTH_DAY regex match to a date."""

    month = _MONTHS[match.group(1).lower()]
    day = int(match.group(2))
    year = int(match.group(3) or anchor.year)
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _parse_anchor_phrase(lowered: str, anchor: date) -> date | None:
    if "today" in lowered:
        return anchor
    if "tomorrow" in lowered:
        return anchor + timedelta(days=1)
    if "day after tomorrow" in lowered:
        return anchor + timedelta(days=2)
    if "next monday" in lowered or "this monday" in lowered:
        return _next_weekday(anchor, _WEEKDAYS["monday"])
    if "next week" in lowered:
        return _next_weekday(anchor, _WEEKDAYS["monday"])
    if "this week" in lowered:
        return anchor
    for name, weekday in _WEEKDAYS.items():
        if re.search(rf"\bnext {name}\b", lowered):
            return _next_weekday(anchor, weekday)
        if re.search(rf"\bthis {name}\b", lowered):
            return _this_weekday(anchor, weekday)
    return None


def _next_weekday(anchor: date, target: int) -> date:
    days_ahead = (target - anchor.weekday() + 7) % 7
    if days_ahead == 0:
        days_ahead = 7
    return anchor + timedelta(days=days_ahead)


def _this_weekday(anchor: date, target: int) -> date:
    days_ahead = (target - anchor.weekday()) % 7
    return anchor + timedelta(days=days_ahead)


def _apply_duration(start: date, lowered: str) -> date | None:
    days_match = _FOR_DAYS.search(lowered)
    if days_match:
        return start + timedelta(days=int(days_match.group(1)) - 1)
    weeks_match = _FOR_WEEKS.search(lowered)
    if weeks_match:
        return start + timedelta(days=int(weeks_match.group(1)) * 7 - 1)
    if "next week" in lowered or "for a week" in lowered:
        return start + timedelta(days=6)
    if "next month" in lowered:
        return start + timedelta(days=29)
    return None
