"""Tests for cancel + 'go back' handling during the booking flow.

Regression: when the user replies 'no' / 'cancel' / 'go back' to a
clarification question, the bot used to store that text as the slot value
and march on to the next field. These tests pin the corrected behavior:

* cancel words exit the booking flow with a friendly message
* 'back' / 'go back' clears the most recently-filled slot so the next pass
  re-asks it instead of advancing
"""

from __future__ import annotations

from datetime import date

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


@respx.mock
async def test_cancel_during_clarification_ends_turn() -> None:
    """User says 'cancel' while we're asking for the project name —
    the bot should drop the booking flow, not store 'cancel' as project_name.

    Runs through the offline path (no API key) — keywords are the fallback.
    """

    from ba_chat.graph import compile_graph

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-cancel-1"}}

    # Turn 1: kick off booking, bot asks for project name.
    first = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create a booking")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )
    assert first["awaiting_user"] == "clarification"

    # Turn 2: user cancels instead of answering.
    second = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="cancel")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    assert second.get("awaiting_user") is None
    assert second.get("missing_slots") == []
    # Slot bag should be empty — 'cancel' must NOT be smuggled into project_name.
    slots = second.get("slots") or {}
    assert "cancel" not in (slots.get("project_name") or "").lower()
    assert slots.get("project_name") is None
    # The visible reply should be a cancellation acknowledgment.
    last_ai = next(m for m in reversed(second["messages"]) if isinstance(m, AIMessage))
    content = last_ai.content if isinstance(last_ai.content, str) else ""
    assert "cancel" in content.lower() or "no problem" in content.lower()


@respx.mock
async def test_no_during_clarification_ends_turn() -> None:
    """'no' on its own at clarification time should also cancel cleanly."""

    from ba_chat.graph import compile_graph

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-cancel-no"}}

    await graph.ainvoke(
        {
            "messages": [HumanMessage(content="create a booking")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )
    second = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="no")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    assert second.get("awaiting_user") is None
    slots = second.get("slots") or {}
    # 'no' must not be stored as a field value.
    for field in ("project_name", "title", "description"):
        assert (slots.get(field) or "").lower() != "no"
    # And the slot bag should be empty after cancellation.
    assert slots == {}


@respx.mock
async def test_go_back_clears_last_filled_slot(monkeypatch: pytest.MonkeyPatch) -> None:
    """'back' should clear the most recently-filled required slot so the
    bot re-asks for it instead of advancing to the next field."""

    from ba_chat import dates
    from ba_chat.graph import compile_graph

    monkeypatch.setattr(dates, "today", lambda: date(2026, 6, 15))

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-back-1"}}

    # Single-shot invocation: feed pre-state directly so we don't accidentally
    # run extract_slots' clarification fallback against an unrelated message.
    # The bot is mid-flow asking for description; the user types 'back'.
    after_back = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="back")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description"],
            "slots": {
                "project_name": "Acme Migration",
                "title": "FE migration sprint",
            },
        },
        config=config,
    )

    slots = after_back.get("slots") or {}
    # Title was the most-recently-filled required slot, so it should be cleared.
    assert slots.get("title") is None
    # project_name is older — should still be there.
    assert slots.get("project_name") == "Acme Migration"
    # The follow-up question must target the cleared field.
    last_ai = next(m for m in reversed(after_back["messages"]) if isinstance(m, AIMessage))
    content = last_ai.content if isinstance(last_ai.content, str) else ""
    assert "title" in content.lower()


# ---------------------------------------------------------------------------
# Tests that exercise the LLM path (API key configured, mock call_json)
# ---------------------------------------------------------------------------

@pytest.fixture
def _llm_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pretend the LLM is configured so the live path runs."""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("BA_CHAT_LLM_MAX_ATTEMPTS", "1")  # no retry needed in tests
    monkeypatch.setenv("BA_CHAT_LLM_BACKOFF_BASE", "0")
    monkeypatch.setenv("BA_CHAT_LLM_BACKOFF_MAX", "0")
    get_settings.cache_clear()


async def test_llm_cancel_triggers_cancellation(_llm_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM returns turn_intent='cancel' → bot cancels the flow."""

    from ba_chat import llm as llm_mod
    from ba_chat.graph import compile_graph

    async def mock_call_json(**_kw):
        from ba_chat.nodes.extract_slots import _SlotExtraction
        return _SlotExtraction(turn_intent="cancel")

    monkeypatch.setattr(llm_mod, "call_json", mock_call_json)

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-llm-cancel"}}
    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="I changed my mind, never mind")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description"],
            "slots": {"project_name": "Acme", "title": "Sprint"},
        },
        config=config,
    )

    assert result.get("awaiting_user") is None
    assert result.get("slots") == {}
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    content = last_ai.content if isinstance(last_ai.content, str) else ""
    assert "cancel" in content.lower() or "no problem" in content.lower()


async def test_llm_side_question_streams_reply(_llm_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM returns turn_intent='side_question' → bot streams the reply
    and keeps the booking slots intact for the next turn."""

    from ba_chat import llm as llm_mod
    from ba_chat.graph import compile_graph

    async def mock_call_json(**_kw):
        from ba_chat.nodes.extract_slots import _SlotExtraction
        return _SlotExtraction(
            turn_intent="side_question",
            side_reply="We have Linh and Minh available next week. Now, what's the title for this booking?",
        )

    monkeypatch.setattr(llm_mod, "call_json", mock_call_json)

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-llm-side"}}
    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="who's free next week?")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["title"],
            "slots": {"project_name": "Acme"},
        },
        config=config,
    )

    # Slots must be preserved (project_name still there, title still missing)
    slots = result.get("slots") or {}
    assert slots.get("project_name") == "Acme"
    assert slots.get("title") is None
    # Bot should have streamed the side reply
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    content = last_ai.content if isinstance(last_ai.content, str) else ""
    assert "Linh" in content or "available" in content.lower()
    # Turn should end (awaiting_user re-set by side_chat so next message routes back)
    assert result.get("awaiting_user") == "clarification"


async def test_llm_go_back_clears_last_slot(_llm_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM returns turn_intent='go_back' → most recently-filled slot is cleared."""

    from ba_chat import llm as llm_mod
    from ba_chat.graph import compile_graph

    async def mock_call_json(**_kw):
        from ba_chat.nodes.extract_slots import _SlotExtraction
        return _SlotExtraction(turn_intent="go_back")

    monkeypatch.setattr(llm_mod, "call_json", mock_call_json)

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-llm-back"}}
    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="wait, let me change the title")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
            "intent": "create_booking",
            "awaiting_user": "clarification",
            "missing_slots": ["description"],
            "slots": {"project_name": "Acme", "title": "Old Title"},
        },
        config=config,
    )

    slots = result.get("slots") or {}
    assert slots.get("title") is None
    assert slots.get("project_name") == "Acme"
