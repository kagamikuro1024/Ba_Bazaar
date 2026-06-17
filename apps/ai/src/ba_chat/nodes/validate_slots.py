"""validate_slots + ask_missing + pick_write_mode — pure logic nodes."""

from __future__ import annotations

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer
from ba_chat.state import ChatState
from ba_chat.tools.date import get_today_iso

_REQUIRED_FIELDS = ["project_name", "title", "description", "start_date", "end_date", "capacity_percent"]
_ALLOWED_CAPACITY = {25, 50, 75, 100}
_ALLOWED_PRIORITY = {"LOW", "MEDIUM", "HIGH", "URGENT"}

_FIELD_PROMPTS: dict[str, str] = {
    "project_name": "Which project is this booking for?",
    "title": "What's a short title for this booking? (e.g. 'FE development for Acme')",
    "description": "Can you describe the work in one sentence?",
    "start_date": "When should this booking start? (e.g. 'tomorrow', 'next Monday', '2026-06-20')",
    "end_date": "When should it end? (e.g. 'for 5 days', 'June 30')",
    "capacity_percent": "What capacity allocation?",
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
    """Generate a clarifying question for the first missing slot.

    Booking slot prompts are deterministic so the flow cannot drift back to a
    field that was already filled. The message still carries action buttons for
    fields with quick replies.
    """
    missing = state.get("missing_slots") or []
    if not missing:
        return {"messages": [AIMessage(content="All set — let me check availability.")]}

    field = missing[0]
    actions = _FIELD_ACTIONS.get(field, [])

    question = _static_question(field)

    msg = AIMessage(content=question)
    msg.additional_kwargs["action_buttons"] = actions
    msg.additional_kwargs["action_field"] = field

    _stream_chunks(question)

    return {
        "messages": [msg],
        "awaiting_user": "clarification",
    }


def _static_question(field: str) -> str:
    """Deterministic fallback question when the LLM is unavailable."""
    if field == "start_date":
        return (
            f"Today is {get_today_iso()}. When should this booking start? "
            "(e.g. 'today', 'tomorrow', 'next Monday', '2026-06-20')"
        )
    if field == "end_date":
        return "When should it end? You can give a date or a duration like 'for 5 days'."
    return _FIELD_PROMPTS.get(field, f"I need the {field.replace('_', ' ')} for this booking.")


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
