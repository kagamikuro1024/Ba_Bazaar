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


def test_dates_parse_duration_from_explicit_anchor() -> None:
    from ba_chat import dates

    start, end = dates.parse_relative("for 5 days", anchor=date(2026, 6, 17))
    assert start == "2026-06-17"
    assert end == "2026-06-21"

    start, end = dates.parse_relative("for 5 days")
    assert start is None
    assert end is None


def test_dates_parse_from_now_to_two_days_later(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 17))
    start, end = dates.parse_relative("from now to two days later")
    assert start == "2026-06-17"
    assert end == "2026-06-19"


def test_dates_parse_iso_range() -> None:
    from ba_chat import dates

    start, end = dates.parse_relative("Book between 2026-07-01 and 2026-07-15")
    assert start == "2026-07-01"
    assert end == "2026-07-15"


def test_dates_parse_dmy_slash_range() -> None:
    from ba_chat import dates

    start, end = dates.parse_relative("từ 22/6/2026 đến 26/6/2026")
    assert start == "2026-06-22"
    assert end == "2026-06-26"


def test_dates_parse_vietnamese_next_week(monkeypatch: pytest.MonkeyPatch) -> None:
    from ba_chat import dates

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 17))
    start, end = dates.parse_relative("tuần sau")
    assert start == "2026-06-22"
    assert end == "2026-06-28"


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
@pytest.mark.parametrize("reply", ["nothing", "none", "skip", "no"])
async def test_description_prompt_accepts_empty_answer(reply: str) -> None:
    """The assistant still asks for description, but an explicit empty answer
    should satisfy that slot and move to the next required field."""

    from ba_chat.graph import compile_graph

    graph = compile_graph()
    config = {"configurable": {"thread_id": f"test-empty-description-{reply}"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content=reply)],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description", "start_date", "end_date", "capacity_percent"],
            "slots": {
                "project_name": "PRM",
                "title": "Discovery sprint",
            },
        },
        config=config,
    )

    slots = result.get("slots") or {}
    missing = result.get("missing_slots") or []
    assert slots.get("description") == ""
    assert "description" not in missing
    assert "start_date" in missing
    assert result.get("awaiting_user") == "clarification"
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    assert "start" in last_ai.content.lower()


@respx.mock
async def test_start_date_answer_does_not_also_fill_end_date(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: answering the start-date question with a single date must
    not also set end_date to the same value, otherwise the bot skips asking
    for the real end date and may submit an invalid/incomplete payload."""

    from ba_chat.graph import compile_graph

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-start-only"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="22/6/2026")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["start_date", "end_date", "capacity_percent"],
            "slots": {
                "project_name": "PRM",
                "title": "Prm",
                "description": "N/A",
            },
        },
        config=config,
    )

    slots = result.get("slots") or {}
    assert slots.get("start_date") == "2026-06-22"
    assert slots.get("end_date") is None
    assert "end_date" in (result.get("missing_slots") or [])


async def test_start_date_range_answer_fills_both_dates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the start-date answer is an explicit range, keep both dates.

    This covers "from now to two days later" from the live flow: the bot
    should advance to capacity instead of asking for description or end_date
    again.
    """

    from ba_chat import dates
    from ba_chat.nodes.extract_slots import extract_slots
    from ba_chat.nodes.validate_slots import validate_slots

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 17))

    state = {
        "messages": [HumanMessage(content="from now to two days later")],
        "user_id": "tester",
        "user_role": "BA_MANAGER",
        "auth_header": "Bearer t",
        "intent": "create_booking",
        "awaiting_user": "clarification",
        "missing_slots": ["start_date", "end_date", "capacity_percent"],
        "slots": {
            "project_name": "1",
            "title": "somehtingadsd",
            "description": "something somehtign",
        },
    }

    extracted = await extract_slots(state)
    result = await validate_slots({**state, **extracted})

    slots = result.get("slots") or {}
    missing = result.get("missing_slots") or []
    assert slots.get("start_date") == "2026-06-17"
    assert slots.get("end_date") == "2026-06-19"
    assert "description" not in missing
    assert "start_date" not in missing
    assert "end_date" not in missing
    assert "capacity_percent" in missing


async def test_short_project_name_clarification_does_not_use_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A short reply like "1" is a valid project name answer.

    The live LLM can return an empty extraction for this, so clarification
    values must be committed deterministically before the LLM path.
    """

    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("project_name clarification should not call the LLM")

    monkeypatch.setattr(extract_slots_node, "call_json_with_retry", fail_if_called)

    result = await extract_slots_node.extract_slots(
        {
            "messages": [HumanMessage(content="1")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["project_name", "title", "description"],
            "slots": {},
        }
    )

    slots = result.get("slots") or {}
    assert slots.get("project_name") == "1"


async def test_description_clarification_value_does_not_use_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plain description answers should satisfy description immediately."""

    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("description clarification should not call the LLM")

    monkeypatch.setattr(extract_slots_node, "call_json_with_retry", fail_if_called)

    result = await extract_slots_node.extract_slots(
        {
            "messages": [HumanMessage(content="something something")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description", "start_date", "end_date"],
            "slots": {
                "project_name": "1",
                "title": "somehtingadsd",
            },
        }
    )

    slots = result.get("slots") or {}
    assert slots.get("description") == "something something"


async def test_direct_project_name_no_cancels_before_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """'no' at project-name clarification is a cancel, not a project name."""

    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("project-name cancellation should not call the LLM")

    monkeypatch.setattr(extract_slots_node, "call_json_with_retry", fail_if_called)

    result = await extract_slots_node.extract_slots(
        {
            "messages": [HumanMessage(content="no")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["project_name", "title"],
            "slots": {},
        }
    )

    assert result.get("cancelled") is True
    assert result.get("slots") == {}


async def test_direct_clarification_still_defers_side_questions_to_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Side questions should still reach the LLM path instead of being stored."""

    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def mock_call_json_with_retry(**_kw: object) -> object:
        return extract_slots_node._SlotExtraction(
            turn_intent="side_question",
            side_reply="I can check that after we finish the booking details.",
        )

    monkeypatch.setattr(
        extract_slots_node,
        "call_json_with_retry",
        mock_call_json_with_retry,
    )

    result = await extract_slots_node.extract_slots(
        {
            "messages": [HumanMessage(content="who's free next week?")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["title"],
            "slots": {"project_name": "Acme"},
        }
    )

    slots = result.get("slots") or {}
    assert slots.get("title") is None
    assert result.get("side_reply_text")


async def test_direct_clarification_still_defers_control_replies_to_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control replies like "wait, change..." should not be stored verbatim."""

    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def mock_call_json_with_retry(**_kw: object) -> object:
        return extract_slots_node._SlotExtraction(turn_intent="go_back")

    monkeypatch.setattr(
        extract_slots_node,
        "call_json_with_retry",
        mock_call_json_with_retry,
    )

    result = await extract_slots_node.extract_slots(
        {
            "messages": [HumanMessage(content="wait, let me change the title")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description"],
            "slots": {"project_name": "Acme", "title": "Old Title"},
        }
    )

    slots = result.get("slots") or {}
    assert slots.get("title") is None
    assert slots.get("project_name") == "Acme"


async def test_end_date_duration_uses_existing_start_date() -> None:
    """When the bot asks for end_date, duration chips like 'for 5 days'
    should resolve against the already-filled start_date."""

    from ba_chat.nodes.extract_slots import extract_slots
    from ba_chat.nodes.validate_slots import validate_slots

    state = {
        "messages": [HumanMessage(content="for 5 days")],
        "user_id": "tester",
        "user_role": "BA_MANAGER",
        "auth_header": "Bearer t",
        "intent": "create_booking",
        "awaiting_user": "clarification",
        "missing_slots": ["end_date", "capacity_percent"],
        "slots": {
            "project_name": "PRM",
            "title": "Discovery sprint",
            "description": "",
            "start_date": "2026-06-17",
        },
    }

    extracted = await extract_slots(state)
    result = await validate_slots({**state, **extracted})

    slots = result.get("slots") or {}
    missing = result.get("missing_slots") or []
    assert slots.get("end_date") == "2026-06-21"
    assert "end_date" not in missing
    assert "capacity_percent" in missing


async def test_ask_missing_keeps_prompt_on_current_slot() -> None:
    """Follow-up questions must stay on missing_slots[0] and carry buttons."""

    import importlib

    validate_slots_node = importlib.import_module("ba_chat.nodes.validate_slots")

    result = await validate_slots_node.ask_missing(
        {
            "messages": [
                HumanMessage(content="from now to two days later"),
            ],
            "slots": {
                "project_name": "1",
                "title": "somehtingadsd",
                "description": "something somehtign",
            },
            "missing_slots": ["start_date", "end_date", "capacity_percent"],
        }
    )

    msg = result["messages"][0]
    assert isinstance(msg, AIMessage)
    assert "start" in msg.content.lower()
    assert "description" not in msg.content.lower()
    assert msg.additional_kwargs["action_field"] == "start_date"
    assert any(
        button["label"] == "Today"
        for button in msg.additional_kwargs["action_buttons"]
    )


@respx.mock
async def test_submit_not_allowed_when_confirmed_but_required_slots_missing() -> None:
    """Regression: confirmation words must not route to submit_booking until
    all required fields are present."""

    from ba_chat.graph import compile_graph

    submit_route = respx.post("http://api.test/api/bookings/request").mock(
        return_value=httpx.Response(200, json={"booking": {"id": "should-not-fire"}})
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-confirm-incomplete"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="đúng")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "confirmed": True,
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "slots": {
                "project_name": "PRM",
                "title": "Prm",
                "description": "N/A",
                "start_date": "2026-06-22",
                # end_date + capacity missing
            },
        },
        config=config,
    )

    assert not submit_route.called
    assert "end_date" in (result.get("missing_slots") or [])
    assert result.get("awaiting_user") == "clarification"


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
