"""validate_slots + ask_missing + pick_write_mode — pure logic nodes."""

from __future__ import annotations

import json

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer
from pydantic import BaseModel, Field

from ba_chat.llm import LLMUnavailable, call_json_with_retry
from ba_chat.state import ChatState
from ba_chat.tools.date import get_today_iso

_REQUIRED_FIELDS = ["project_name", "title", "description", "start_date", "end_date", "capacity_percent"]
_ALLOWED_CAPACITY = {25, 50, 75, 100}
_ALLOWED_PRIORITY = {"LOW", "MEDIUM", "HIGH", "URGENT"}

_FIELD_PROMPTS: dict[str, str] = {
    "project_name": "Which project is this booking for?",
    "title": "What's a short title for this booking? (e.g. 'FE development for Acme')",
    "description": "Can you describe the work in one sentence?",
    "start_date": "When should this booking start?",
    "end_date": "When should it end?",
    "capacity_percent": "What capacity allocation?",
}

_FIELD_DESCRIPTIONS: dict[str, str] = {
    "project_name": "Project or client name for the booking.",
    "title": "Short booking title, usually 1-10 words.",
    "description": "One-sentence work description. The user may answer skip, none, or no.",
    "start_date": "Booking start date. Accept natural language dates relative to today.",
    "end_date": "Booking end date. Accept a date or duration such as for 5 days.",
    "capacity_percent": "Allocation percentage. Must resolve to 25, 50, 75, or 100.",
}

# Action buttons per field. The frontend renders these as clickable chips.
# Each button has `label` (display text) and `value` (sent back as message).
_FIELD_ACTIONS: dict[str, list[dict[str, str]]] = {
    "capacity_percent": [
        {"label": "25%", "value": "25"},
        {"label": "50%", "value": "50"},
        {"label": "75%", "value": "75"},
        {"label": "100%", "value": "100"},
        {"label": "Custom", "value": "__custom__"},
    ],
    "priority": [
        {"label": "Low", "value": "LOW"},
        {"label": "Medium", "value": "MEDIUM"},
        {"label": "High", "value": "HIGH"},
        {"label": "Urgent", "value": "URGENT"},
    ],
    "start_date": [
        {"label": "Today", "value": "today"},
        {"label": "Tomorrow", "value": "tomorrow"},
        {"label": "Next Monday", "value": "next Monday"},
        {"label": "Custom date", "value": "__custom__"},
    ],
    "end_date": [
        {"label": "1 day", "value": "for 1 day"},
        {"label": "3 days", "value": "for 3 days"},
        {"label": "5 days", "value": "for 5 days"},
        {"label": "1 week", "value": "for 1 week"},
        {"label": "2 weeks", "value": "for 2 weeks"},
        {"label": "Custom", "value": "__custom__"},
    ],
}

_BOOKING_FIELD_CONTRACT = """
You are collecting fields for a Ba_Bazaar booking. Be conversational, not a rigid form.

Required fields and constraints:
- project_name: project or client name; text.
- title: short booking title; 1-10 words.
- description: one-sentence work description; user can say skip/none.
- start_date: booking start date; accept natural language dates relative to today.
- end_date: booking end date; accept a date or duration such as "for 5 days".
- capacity_percent: allocation; must resolve to one of 25, 50, 75, 100.

Optional fields:
- ba_name: BA/person to assign if user mentions one.
- priority: LOW, MEDIUM, HIGH, or URGENT; default is MEDIUM.

Rules:
- You will receive the missing_fields JSON array from the app.
- Choose exactly one field from missing_fields to ask about next.
- Do not list examples unless it genuinely helps the current field.
- Do not expose internal field names like start_date or capacity_percent.
- If asking for a date, mention today's date only if it helps disambiguate relative dates.
- Keep the question short and friendly.
- Return JSON only, with exactly two keys: "field" and "question".
""".strip()


class _MissingFieldPrompt(BaseModel):
    field: str = Field(description="One field name chosen from the missing_fields JSON array.")
    question: str = Field(
        description="A short conversational question asking for exactly the next missing booking field."
    )


async def validate_slots(state: ChatState) -> ChatState:
    """Check which required fields are missing or invalid. Pure, no IO."""
    slots: dict = dict(state.get("slots") or {})
    missing: list[str] = []

    for field in _REQUIRED_FIELDS:
        value = slots.get(field)
        if field == "description" and "description" in slots and value is not None:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(field)

    # Validate capacity_percent enum
    cap = slots.get("capacity_percent")
    if cap is not None:
        try:
            cap = int(cap)
            slots["capacity_percent"] = cap
        except (TypeError, ValueError):
            cap = None
        if cap not in _ALLOWED_CAPACITY:
            slots.pop("capacity_percent", None)
            if "capacity_percent" not in missing:
                missing.append("capacity_percent")

    # Validate priority enum (default to MEDIUM if missing — it's optional)
    priority = slots.get("priority")
    if priority and str(priority).upper() not in _ALLOWED_PRIORITY:
        slots["priority"] = "MEDIUM"
    elif priority:
        slots["priority"] = str(priority).upper()
    else:
        slots["priority"] = "MEDIUM"

    # Validate date order
    start = slots.get("start_date", "")
    end = slots.get("end_date", "")
    if start and end and start > end:
        slots["end_date"] = None
        if "end_date" not in missing:
            missing.append("end_date")

    return {"slots": slots, "missing_slots": missing}


async def ask_missing(state: ChatState) -> ChatState:
    """Ask for the next missing booking field using the LLM field contract."""
    missing = state.get("missing_slots") or []
    if not missing:
        return {"messages": [AIMessage(content="All set — let me check availability.")]}

    field, question = await _next_missing_field_question(state, missing)
    actions = _FIELD_ACTIONS.get(field, [])
    reordered_missing = _prioritize_missing_field(missing, field)

    msg = AIMessage(content=question)
    msg.additional_kwargs["action_buttons"] = actions
    msg.additional_kwargs["action_field"] = field

    _stream_chunks(question)

    return {
        "messages": [msg],
        "awaiting_user": "clarification",
        "missing_slots": reordered_missing,
    }


def _static_question(field: str) -> str:
    """Deterministic fallback question when the LLM is unavailable."""
    if field == "start_date":
        return "When should this booking start?"
    if field == "end_date":
        return "When should it end? You can give a date or a duration like 'for 5 days'."
    return _FIELD_PROMPTS.get(field, f"I need the {field.replace('_', ' ')} for this booking.")


async def _next_missing_field_question(
    state: ChatState,
    missing: list[str] | None = None,
) -> tuple[str, str]:
    """Let the LLM choose which missing field to collect next."""

    missing = list(missing or state.get("missing_slots") or [])
    if not missing:
        return "project_name", "What would you like to book?"
    fallback_field = missing[0]
    slots = state.get("slots") or {}
    missing_field_specs = _missing_field_specs(missing)
    user_prompt = (
        f"Today: {get_today_iso()}\n"
        f"Already collected slots: {slots!r}\n"
        f"missing_fields JSON:\n{json.dumps(missing_field_specs, ensure_ascii=False)}\n\n"
        'Return JSON only: {"field": "<one missing field name>", '
        '"question": "<next assistant question>"}'
    )
    try:
        result = await call_json_with_retry(
            system=_BOOKING_FIELD_CONTRACT,
            user=user_prompt,
            schema=_MissingFieldPrompt,
            node_name="ask_missing",
        )
        field = result.field.strip()
        question = result.question.strip()
        if field in missing and question:
            return field, question
    except (LLMUnavailable, AttributeError):
        pass
    return fallback_field, _static_question(fallback_field)


def _missing_field_specs(missing: list[str]) -> list[dict[str, object]]:
    specs: list[dict[str, object]] = []
    for field in missing:
        spec: dict[str, object] = {
            "field": field,
            "description": _FIELD_DESCRIPTIONS.get(field, field.replace("_", " ")),
        }
        actions = _FIELD_ACTIONS.get(field)
        if actions:
            spec["quick_replies"] = [
                {"label": action["label"], "value": action["value"]}
                for action in actions
            ]
        specs.append(spec)
    return specs


def _prioritize_missing_field(missing: list[str], field: str) -> list[str]:
    if field not in missing:
        return missing
    return [field, *(item for item in missing if item != field)]


def _stream_chunks(text: str, *, chunk_size: int = 18) -> None:
    try:
        writer = get_stream_writer()
    except Exception:
        return
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        writer({"type": "token", "text": text[i : i + chunk_size]})


async def pick_write_mode(state: ChatState) -> ChatState:
    """Set write_mode based on role: BA_MANAGER with ba_id → direct, else request."""
    role = state.get("user_role", "")
    slots = state.get("slots") or {}
    ba_id = slots.get("ba_id")
    if role == "BA_MANAGER" and ba_id:
        return {"write_mode": "direct"}
    return {"write_mode": "request"}
