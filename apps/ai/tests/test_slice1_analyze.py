"""End-to-end test for slice 1 (analyze path) with no real network access."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from langchain_core.messages import AIMessage, HumanMessage

from ba_chat.config import get_settings
from ba_chat.graph import compile_graph


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the fallback path: API stubbed via respx, no DeepSeek key."""

    monkeypatch.setenv("BA_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("BA_API_TIMEOUT_SECONDS", "5")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    get_settings.cache_clear()


@respx.mock
async def test_analyze_dashboard_uses_fallback_summary() -> None:
    payload = {
        "timeframe": {"from": "2026-06-01", "to": "2026-06-30"},
        "team": {
            "total_ba": 12,
            "team_utilization_percent": 76,
            "bench_count": 2,
            "bench_rate_percent": 16.7,
            "overbooked_count": 1,
            "total_man_days": 182,
            "total_available_man_days": 240,
        },
        "actions": {
            "pending_requests": 8,
            "unassigned_requests": 3,
            "urgent_requests": 2,
            "overbooked_ba": 1,
            "bench_ba": 2,
        },
    }

    respx.get("http://api.test/api/dashboard/manager-summary").mock(
        return_value=httpx.Response(200, json=payload)
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-dash"}}
    inputs = {
        "messages": [HumanMessage(content="show me the team dashboard")],
        "user_id": "tester",
        "user_role": "BA_MANAGER",
        "auth_header": "Bearer test-token",
    }

    result = await graph.ainvoke(inputs, config=config)

    assert result["intent"] == "analyze"
    assert result["analyze_target"] == "manager_dashboard"
    assert result["metrics"] == payload

    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    text = last_ai.content
    assert "76%" in text
    assert "12" in text  # active BA count
    assert "182" in text  # booked man-days
    assert "8" in text   # pending requests


@respx.mock
async def test_smalltalk_routes_to_respond() -> None:
    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-smalltalk"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="hi there")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": None,
        },
        config=config,
    )

    assert result["intent"] == "smalltalk"
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    assert "manager dashboard" in last_ai.content.lower()


async def test_explicit_booking_command_wins_after_dashboard_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import importlib

    router_node = importlib.import_module("ba_chat.nodes.router")

    async def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("explicit booking commands should not call the LLM router")

    monkeypatch.setattr(router_node, "call_json_with_retry", fail_if_called)

    result = await router_node.router(
        {
            "messages": [
                HumanMessage(content="Show me the manager dashboard"),
                AIMessage(content="Team utilization is 18.5% with 11 pending requests."),
                HumanMessage(content="create booking"),
            ],
            "awaiting_user": None,
        }
    )

    assert result["intent"] == "create_booking"
    assert result["analyze_target"] is None


@respx.mock
async def test_action_center_uses_llm_summary_payload() -> None:
    payload = {
        "summary": "Two urgent requests are unassigned.",
        "bullets": [
            {"text": "8 pending requests, 2 urgent.", "citations": ["C1"]},
            {"text": "3 requests still need a BA.", "citations": ["C2"]},
        ],
        "citations": [
            {"id": "C1", "label": "Pending", "value": "8 pending"},
            {"id": "C2", "label": "Unassigned", "value": "3 unassigned"},
        ],
        "provider": "fallback",
        "grounded": True,
    }

    respx.get("http://api.test/api/bookings/action-center/llm-summary").mock(
        return_value=httpx.Response(200, json=payload)
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-action"}}

    result = await graph.ainvoke(
        {
            "messages": [
                HumanMessage(content="what's pending in the action center inbox?")
            ],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": "Bearer t",
        },
        config=config,
    )

    assert result["analyze_target"] == "action_center"
    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    body = last_ai.content
    assert "Two urgent requests" in body
    assert "still need a BA" in body


@respx.mock
async def test_api_error_surfaces_friendly_message() -> None:
    respx.get("http://api.test/api/dashboard/manager-summary").mock(
        return_value=httpx.Response(500, text="boom")
    )

    graph = compile_graph()
    config = {"configurable": {"thread_id": "test-error"}}

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="dashboard please")],
            "user_id": "tester",
            "user_role": "BA_MANAGER",
            "auth_header": None,
        },
        config=config,
    )

    last_ai = next(m for m in reversed(result["messages"]) if isinstance(m, AIMessage))
    assert "couldn't load" in last_ai.content
    assert result["error"] is not None


def test_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BA_API_BASE_URL", raising=False)
    monkeypatch.delenv("BA_API_TOKEN", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.api_base_url == "http://localhost:3000"
    assert settings.has_llm is False
    assert settings.deepseek_model == "deepseek-v4-flash"


def test_router_ignores_unknown_analyze_target() -> None:
    from ba_chat.nodes.router import _RouteDecision

    decision = _RouteDecision.model_validate(
        {"intent": "analyze", "analyze_target": "network"}
    )

    assert decision.intent == "analyze"
    assert decision.analyze_target is None


def test_state_payload_serialises_cleanly() -> None:
    """Sanity check that state dicts can survive the LangGraph checkpointer."""

    from ba_chat.state import empty_state

    state = empty_state()
    state["user_role"] = "PM_PO"
    json.dumps(state)
