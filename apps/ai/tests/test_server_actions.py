from __future__ import annotations

from langchain_core.messages import AIMessage

from ba_chat.server import _latest_ai_message_metadata


def test_latest_ai_message_metadata_uses_latest_actions() -> None:
    capacity_prompt = AIMessage(content="What capacity allocation?")
    capacity_prompt.additional_kwargs["action_buttons"] = [
        {"label": "100%", "value": "100"},
    ]
    capacity_prompt.additional_kwargs["action_field"] = "capacity_percent"
    confirmation = AIMessage(content="Ready to submit this booking")
    confirmation.additional_kwargs["action_buttons"] = [
        {"label": "Yes", "value": "yes"},
        {"label": "No", "value": "no"},
    ]
    confirmation.additional_kwargs["action_field"] = "confirmation"

    msg, buttons, field = _latest_ai_message_metadata([capacity_prompt, confirmation])

    assert msg is confirmation
    assert buttons == [
        {"label": "Yes", "value": "yes"},
        {"label": "No", "value": "no"},
    ]
    assert field == "confirmation"


def test_latest_ai_message_metadata_clears_actions_when_latest_has_none() -> None:
    capacity_prompt = AIMessage(content="What capacity allocation?")
    capacity_prompt.additional_kwargs["action_buttons"] = [
        {"label": "100%", "value": "100"},
    ]
    capacity_prompt.additional_kwargs["action_field"] = "capacity_percent"
    plain_reply = AIMessage(content="I updated that.")

    msg, buttons, field = _latest_ai_message_metadata([capacity_prompt, plain_reply])

    assert msg is plain_reply
    assert buttons is None
    assert field is None


def test_latest_ai_message_metadata_keeps_latest_actions() -> None:
    prompt = AIMessage(content="What capacity allocation?")
    prompt.additional_kwargs["action_buttons"] = [
        {"label": "100%", "value": "100"},
    ]
    prompt.additional_kwargs["action_field"] = "capacity_percent"

    msg, buttons, field = _latest_ai_message_metadata([prompt])

    assert msg is prompt
    assert buttons == [{"label": "100%", "value": "100"}]
    assert field == "capacity_percent"
