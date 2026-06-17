from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage


async def test_confirm_adds_yes_no_action_buttons() -> None:
    from ba_chat.nodes.booking_flow import confirm

    result = await confirm(
        {
            "slots": {
                "project_name": "1",
                "title": "FE development",
                "description": "",
                "start_date": "2026-06-17",
                "end_date": "2026-06-30",
                "capacity_percent": 100,
                "priority": "MEDIUM",
            },
            "candidates": [],
            "simulation": None,
        }
    )

    msg = result["messages"][0]
    assert isinstance(msg, AIMessage)
    assert result["awaiting_user"] == "confirmation"
    assert msg.additional_kwargs["action_field"] == "confirmation"
    assert msg.additional_kwargs["action_buttons"] == [
        {"label": "Yes", "value": "yes"},
        {"label": "No", "value": "no"},
    ]


async def test_confirmation_yes_no_are_deterministic(
    monkeypatch,
) -> None:
    import importlib

    extract_slots_node = importlib.import_module("ba_chat.nodes.extract_slots")

    async def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("confirmation yes/no should not call the LLM")

    monkeypatch.setattr(extract_slots_node, "call_json_with_retry", fail_if_called)

    base_state = {
        "user_id": "tester",
        "user_role": "BA_MANAGER",
        "auth_header": "Bearer t",
        "intent": "create_booking",
        "awaiting_user": "confirmation",
        "slots": {
            "project_name": "1",
            "title": "FE development",
            "description": "",
            "start_date": "2026-06-17",
            "end_date": "2026-06-30",
            "capacity_percent": 100,
        },
    }

    yes_result = await extract_slots_node.extract_slots(
        {**base_state, "messages": [HumanMessage(content="yes")]}
    )
    no_result = await extract_slots_node.extract_slots(
        {**base_state, "messages": [HumanMessage(content="no")]}
    )

    assert yes_result.get("confirmed") is True
    assert no_result.get("cancelled") is True
    assert no_result.get("slots") == {}
