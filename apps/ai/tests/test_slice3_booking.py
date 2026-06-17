"""Tests for slice 3+4: booking creation flow with mocked API."""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx
from langchain_core.messages import AIMessage, HumanMessage

from ba_chat.config import get_settings


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BA_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("BA_API_TIMEOUT_SECONDS", "5")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    get_settings.cache_clear()


def test_dates_parse_tomorrow(monkeypatch: pytest.MonkeyPatch) -> None:
    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))
    start, end = dates.parse_relative("create booking for tomorrow")
    assert start == "2026-06-16"
    assert end == "2026-06-16"


@pytest.mark.parametrize(
    "phrase",
    [
        "create booking for tommor",
        "create booking for tommorrow",
        "create booking for tomorow",
        "book for tmrw",
        "schedule it tmr",
        "tomo please",
    ],
)
def test_dates_parse_tomorrow_typos(
    monkeypatch: pytest.MonkeyPatch, phrase: str
) -> None:
    """Common typos and abbreviations of 'tomorrow' should still resolve."""

    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))
    start, end = dates.parse_relative(phrase)
    assert start == "2026-06-16", f"failed to parse start in {phrase!r}"
    assert end == "2026-06-16", f"failed to parse end in {phrase!r}"


def test_dates_parse_day_after_tomorrow_typo(monkeypatch: pytest.MonkeyPatch) -> None:
    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))
    start, end = dates.parse_relative("day after tommorrow")
    assert start == "2026-06-17"
    assert end == "2026-06-17"


def test_dates_parse_for_5_days(monkeypatch: pytest.MonkeyPatch) -> None:
    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))
    start, end = dates.parse_relative("from June 20 for 5 days")
    assert start == "2026-06-20"
    assert end == "2026-06-24"


def test_dates_parse_iso_range() -> None:
    from ba_chat import dates

    start, end = dates.parse_relative("Book between 2026-07-01 and 2026-07-15")
    assert start == "2026-07-01"
    assert end == "2026-07-15"


def test_dates_parse_no_dates() -> None:
    from ba_chat import dates

    start, end = dates.parse_relative("create a booking please")
    assert start is None
    assert end is None


@respx.mock
async def test_booking_flow_progresses_with_typoed_tomorrow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: 'create booking for tommor' should resolve start/end dates
    on the very first turn so the bot only needs to ask for the *other*
    missing fields. Before the fix, the typo caused the date parser to
    return (None, None) and the assistant kept walking through every field
    while the user re-typed the same command."""

    from ba_chat import dates
    from ba_chat.graph import compile_graph

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-typo-1"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create booking for tommor")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    assert result["intent"] == "create_booking"
    slots = result.get("slots") or {}
    # The typo should have been recognised as 'tomorrow' (2026-06-16).
    assert slots.get("start_date") == "2026-06-16"
    assert slots.get("end_date") == "2026-06-16"
    # And the bot should be asking about a non-date field next.
    missing = result.get("missing_slots") or []
    assert "start_date" not in missing
    assert "end_date" not in missing


@respx.mock
async def test_clarification_ignores_repeated_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: when the user repeats 'create booking for tommor' instead
    of answering the field we asked about, the offline fallback must NOT
    store that whole sentence as the project name / title / description."""

    from ba_chat import dates
    from ba_chat.graph import compile_graph

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-typo-2"}}

    # Turn 1 — user kicks off booking with a typoed date.
    first = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create booking for tommor")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )
    assert first["awaiting_user"] == "clarification"

    # Turn 2 — instead of answering, the user just retypes the command.
    second = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create booking for tommor")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    slots = second.get("slots") or {}
    # The retyped command must not have been smuggled into a text field.
    for field in ("project_name", "title", "description"):
        value = slots.get(field)
        if value is not None:
            assert "create booking" not in value.lower(), (
                f"{field} got the restated command stored verbatim: {value!r}"
            )
    # Dates should still be present from turn 1 (carried in checkpointer state).
    assert slots.get("start_date") == "2026-06-16"
    assert slots.get("end_date") == "2026-06-16"


@respx.mock
async def test_booking_flow_asks_for_missing_fields() -> None:
    from ba_chat.graph import compile_graph

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-1"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create a booking")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    assert result["intent"] == "create_booking"
    assert result["awaiting_user"] == "clarification"
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    # Should ask for the first missing required field
    assert "?" in last_ai.content


@respx.mock
async def test_booking_flow_reaches_confirm_with_complete_slots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ba_chat import dates
    from ba_chat.graph import compile_graph

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))

    # Mock recommendations endpoint
    respx.get("http://api.test/api/ba/recommendations").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"ba_id": "ba-1", "full_name": "Linh", "fit_score": 87},
                {"ba_id": "ba-2", "full_name": "Minh", "fit_score": 72},
            ],
        )
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-2"}}

    # Use keyword-router fallback (no LLM key) — must include all fields in slots
    # by pre-seeding state. The LLM extractor would normally do this; for the
    # offline path we exercise the graph directly with a complete slot set.
    seed_slots = {
        "project_name": "Acme Migration",
        "title": "FE migration sprint",
        "description": "Migrate the Acme dashboard to the new design system",
        "start_date": "2026-06-20",
        "end_date": "2026-06-24",
        "capacity_percent": 50,
        "priority": "MEDIUM",
    }

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="book a BA for this work")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "slots": seed_slots,
        },
        config=config,
    )

    assert result["intent"] == "create_booking"
    assert result["awaiting_user"] == "confirmation"
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    body = last_ai.content
    assert "Acme Migration" in body
    assert "2026-06-20" in body
    assert "50%" in body
    assert "Linh" in body  # candidate surfaced


@respx.mock
async def test_submit_only_fires_when_confirmed_and_authorized() -> None:
    """submit_booking should only mutate when confirmed=True comes from user reply."""

    from ba_chat.graph import compile_graph

    # Mock the write endpoint so we can verify it WAS called when confirmed=True
    submit_route = respx.post("http://api.test/api/bookings/request").mock(
        return_value=httpx.Response(
            200,
            json={"booking": {"id": "bk-42", "status": "PENDING"}, "warning": None},
        )
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-3"}}

    # Seed a complete booking with confirmed=True (simulating the user having
    # said "yes" in a previous turn parsed by extract_slots).
    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="yes, submit")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "confirmed": True,
            "intent": "create_booking",
            "awaiting_user": "confirmation",
            "slots": {
                "project_id": "p-1",
                "title": "x",
                "description": "y",
                "start_date": "2026-06-20",
                "end_date": "2026-06-24",
                "capacity_percent": 50,
            },
        },
        config=config,
    )

    assert submit_route.called
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    assert "Booking created" in last_ai.content
    assert "bk-42" in last_ai.content


@respx.mock
async def test_submit_blocked_without_confirmed_flag() -> None:
    """Without confirmed=True, the router must NOT route to submit_booking."""

    from ba_chat.graph import compile_graph

    submit_route = respx.post("http://api.test/api/bookings/request").mock(
        return_value=httpx.Response(200, json={"booking": {"id": "should-not-fire"}})
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-bk-block"}}

    # Same complete state but confirmed=False — router must NOT take the
    # submit edge. It should re-enter the booking flow and re-render confirm.
    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="hmm not sure")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "confirmed": False,
            "intent": "create_booking",
            "awaiting_user": "confirmation",
            "slots": {
                "project_id": "p-1",
                "title": "x",
                "description": "y",
                "start_date": "2026-06-20",
                "end_date": "2026-06-24",
                "capacity_percent": 50,
            },
        },
        config=config,
    )

    assert not submit_route.called
    last_ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]
    assert not any("Booking created" in m.content for m in last_ai_messages)
