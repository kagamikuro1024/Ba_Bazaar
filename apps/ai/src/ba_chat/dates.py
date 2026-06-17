"""Deterministic date parsing for slot extraction.

The LLM should never hallucinate dates. We resolve relative phrases
(``tomorrow``, ``next week``, ``from June 20 for 5 days``) here in
Python so the agent stays grounded in the server's calendar.

Returns ISO ``YYYY-MM-DD`` strings, the format the Go API expects.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from ba_chat.tools.date import get_today

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

_ISO = re.compile(r"\b(\d{4})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b")
# DD/MM/YYYY or D/M/YYYY (common in non-US locales, e.g. 22/6/2026)
_DMY_SLASH = re.compile(r"\b(0?[1-9]|[12]\d|3[01])/(0?[1-9]|1[0-2])/(\d{4})\b")
_FOR_DAYS = re.compile(r"for\s+(\d+)\s+days?", re.IGNORECASE)
_FOR_WEEKS = re.compile(r"for\s+(\d+)\s+weeks?", re.IGNORECASE)
_NUMBER_WORDS = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}
_NUMBER_TOKEN = r"\d+|" + "|".join(re.escape(word) for word in _NUMBER_WORDS)
_DAY_OFFSET = re.compile(
    rf"\b(?:in|after)\s+({_NUMBER_TOKEN})\s+days?\b|"
    rf"\b({_NUMBER_TOKEN})\s+days?\s+(?:later|from\s+now)\b",
    re.IGNORECASE,
)
_MONTH_DAY = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b",
    re.IGNORECASE,
)

# Common typos / abbreviations users actually type. Order matters — longer
# patterns first so "tomo" doesn't shadow "tomorrow".
_TOMORROW_PATTERNS = (
    r"tomorrow", r"tommorrow", r"tommorow", r"tomorow", r"tommrow",
    r"tmrw", r"tmr", r"tmrrw", r"tomo", r"tommor", r"tommorw", r"tmw",
)
_TODAY_PATTERNS = (r"today", r"tdy", r"tody")
_TOMORROW_RE = re.compile(
    r"\b(" + "|".join(_TOMORROW_PATTERNS) + r")\b", re.IGNORECASE
)
_TODAY_RE = re.compile(
    r"\b(" + "|".join(_TODAY_PATTERNS) + r"|now)\b", re.IGNORECASE
)
_DAY_AFTER_TOMORROW_RE = re.compile(
    r"\bday\s+after\s+(" + "|".join(_TOMORROW_PATTERNS) + r")\b", re.IGNORECASE
)


def today() -> date:
    """Hook so tests can monkeypatch."""

    return get_today()


def to_iso(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def parse_relative(text: str, *, anchor: date | None = None) -> tuple[str | None, str | None]:
    """Return ``(start_iso, end_iso)`` extracted from ``text`` if possible.

    The function is deliberately permissive — it returns ``(None, None)`` when
    nothing parseable is found, leaving the LLM to fall back on ``ask_missing``.
    """

    if not text:
        return None, None
    explicit_anchor = anchor
    anchor = anchor or today()
    lowered = text.lower()

    anchored_offset = _parse_now_to_day_offset(lowered, anchor)
    if anchored_offset:
        start, end = anchored_offset
        return to_iso(start), to_iso(end)

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

    # DD/MM/YYYY slash dates (e.g. "22/6/2026", "from 22/6/2026 to 26/6/2026")
    dmy_matches = _DMY_SLASH.findall(text)
    if len(dmy_matches) >= 2:
        a = _dmy_to_date(dmy_matches[0])
        b = _dmy_to_date(dmy_matches[1])
        if a and b:
            start, end = sorted((a, b))
            return to_iso(start), to_iso(end)
    if len(dmy_matches) == 1:
        only = _dmy_to_date(dmy_matches[0])
        if only:
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
        if explicit_anchor is not None:
            end = _apply_duration(anchor, lowered)
            if end:
                return to_iso(anchor), to_iso(end)
        return None, None
    end = _apply_duration(start, lowered) or start
    return to_iso(start), to_iso(end)


def _dmy_to_date(groups: tuple[str, ...]) -> date | None:
    """Convert (day, month, year) regex groups to a date."""
    try:
        return date(int(groups[2]), int(groups[1]), int(groups[0]))
    except (ValueError, IndexError):
        return None


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
    if _DAY_AFTER_TOMORROW_RE.search(lowered):
        return anchor + timedelta(days=2)
    if _TOMORROW_RE.search(lowered):
        return anchor + timedelta(days=1)
    if _TODAY_RE.search(lowered):
        return anchor
    if "next monday" in lowered or "this monday" in lowered:
        return _next_weekday(anchor, _WEEKDAYS["monday"])
    if "next week" in lowered or "tuần sau" in lowered or "tuan sau" in lowered:
        return _next_weekday(anchor, _WEEKDAYS["monday"])
    if "this week" in lowered or "tuần này" in lowered or "tuan nay" in lowered:
        return anchor
    for name, weekday in _WEEKDAYS.items():
        if re.search(rf"\bnext {name}\b", lowered):
            return _next_weekday(anchor, weekday)
        if re.search(rf"\bthis {name}\b", lowered):
            return _this_weekday(anchor, weekday)
    return None


def _parse_now_to_day_offset(lowered: str, anchor: date) -> tuple[date, date] | None:
    if not re.search(r"\b(?:from|starting|start)\s+(?:now|today)\b", lowered):
        return None
    if not re.search(r"\b(?:to|until|through|till)\b", lowered):
        return None
    offset = _parse_day_offset(lowered)
    if offset is None:
        return None
    return anchor, anchor + timedelta(days=offset)


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
    offset = _parse_day_offset(lowered)
    if offset is not None:
        return start + timedelta(days=offset)
    if "next week" in lowered or "tuần sau" in lowered or "tuan sau" in lowered or "for a week" in lowered:
        return start + timedelta(days=6)
    if "next month" in lowered:
        return start + timedelta(days=29)
    return None


def _parse_day_offset(lowered: str) -> int | None:
    match = _DAY_OFFSET.search(lowered)
    if not match:
        return None
    token = next((group for group in match.groups() if group), None)
    if not token:
        return None
    if token.isdigit():
        return int(token)
    return _NUMBER_WORDS.get(token.lower())
