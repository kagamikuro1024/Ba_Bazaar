"""validate_slots + ask_missing + pick_write_mode — pure logic nodes."""

from __future__ import annotations

import logging

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer
from ba_chat.state import ChatState

log = logging.getLogger(__name__)
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

    Uses the LLM to produce a conversational, context-aware question that
    streams word-by-word as DeepSeek generates it. Falls back to static prompts
    when the LLM is unavailable (offline / CI).
    """
    missing = state.get("missing_slots") or []
    if not missing:
        return {"messages": [AIMessage(content="All set — let me check availability.")]}

    field = missing[0]
    actions = _FIELD_ACTIONS.get(field, [])

    # Stream tokens word-by-word from DeepSeek. Returns (text, was_streamed).
    question, was_streamed = await _llm_question(state, field, missing)

    msg = AIMessage(content=question)
    msg.additional_kwargs["action_buttons"] = actions
    msg.additional_kwargs["action_field"] = field

    # Only fake-stream when the LLM path didn't already stream (static fallback).
    if not was_streamed:
        _stream_chunks(question)

    return {
        "messages": [msg],
        "awaiting_user": "clarification",
    }


async def _llm_question(
    state: ChatState, field: str, missing: list[str]
) -> tuple[str, bool]:
    """Ask the LLM to produce a conversational follow-up question.

    Uses stream_chat so tokens appear word-by-word as DeepSeek generates them
    instead of waiting for the full response before showing anything.
    Falls back to the static prompt when the LLM is unavailable.

    Returns (question_text, was_streamed). ``was_streamed`` is True only when
    tokens were actually emitted to the stream writer, so the caller knows
    whether it still needs to fake-stream the static fallback.
    """

    from ba_chat.config import get_settings
    from ba_chat.llm import ChatMessage, LLMUnavailable, stream_chat

    settings = get_settings()
    if not settings.has_llm:
        log.info("ask_missing: no LLM configured, using static prompt for %s", field)
        return _static_question(field), False

    log.info("ask_missing: streaming LLM question for field=%s", field)

    slots = state.get("slots") or {}
    user_provided = {
        k: v for k, v in slots.items()
        if v and k not in ("priority",)
    }
    filled = ", ".join(f"{k}={v!r}" for k, v in user_provided.items()) or "nothing yet"
    remaining = ", ".join(missing[1:]) if len(missing) > 1 else "none"

    context_lines: list[str] = []
    for msg in state.get("messages", [])[-6:]:
        role = getattr(msg, "type", "")
        text = msg.content if isinstance(msg.content, str) else ""
        if text:
            context_lines.append(f"{role}: {text[:200]}")
    conversation = "\n".join(context_lines) or "(no prior messages)"

    messages = [
        ChatMessage(
            role="system",
            content=(
                "You are a friendly BA resource booking assistant. "
                "Generate ONE short, natural follow-up question (1-2 sentences max) "
                "to collect the next booking detail. "
                "Acknowledge what the user already told us. "
                "Do not mention fields already filled. "
                "Do not explain yourself — just ask the question. "
                "Keep it under 50 words."
            ),
        ),
        ChatMessage(
            role="user",
            content=(
                f"Conversation so far:\n{conversation}\n\n"
                f"Slots already filled: {filled}\n"
                f"Next field needed: {field}\n"
                f"Fields still needed after this: {remaining}\n\n"
                f"Ask for the '{field}' value conversationally."
            ),
        ),
    ]

    try:
        writer = _safe_writer()
        chunks: list[str] = []
        emitted = False
        async for delta in stream_chat(messages, temperature=0.4):
            chunks.append(delta)
            if writer and delta:
                writer({"type": "token", "text": delta})
                emitted = True
        question = "".join(chunks).strip()
        if question:
            return question, emitted
        log.warning("ask_missing: LLM returned empty question, using static fallback")
    except LLMUnavailable as exc:
        log.warning("ask_missing: LLM streaming failed (%s), using static fallback", exc)
    except Exception as exc:
        log.warning("ask_missing: unexpected error (%s), using static fallback", exc)

    return _static_question(field), False


def _safe_writer():
    try:
        return get_stream_writer()
    except Exception:
        return None


def _static_question(field: str) -> str:
    """Deterministic fallback question when the LLM is unavailable."""
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
