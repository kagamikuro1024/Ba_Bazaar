"""extract_slots — pull booking fields from the latest user message.

Two-phase:
1. Date resolution: deterministic Python (dates.py) — never LLM.
2. Structured extraction: DeepSeek JSON-mode for project, BA, capacity,
   title, description. Falls back to empty slots when LLM is unavailable
   so validate_slots can ask_missing one field at a time.
"""

from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field

from ba_chat.dates import parse_relative
from ba_chat.llm import LLMUnavailable, call_json
from ba_chat.state import ChatState

log = logging.getLogger(__name__)

_CAPACITY_VALUES = {25, 50, 75, 100}


class _SlotExtraction(BaseModel):
    project_name: str | None = Field(
        default=None,
        description="Project name if mentioned. Use null if not found.",
    )
    ba_name: str | None = Field(
        default=None,
        description="Full name of the BA if explicitly mentioned. Use null otherwise.",
    )
    title: str | None = Field(
        default=None,
        description="Short booking title (1-10 words). Derive from context if clear.",
    )
    description: str | None = Field(
        default=None,
        description="One-sentence description of the work. Derive from context.",
    )
    capacity_percent: int | None = Field(
        default=None,
        description="Capacity percentage: must be exactly 25, 50, 75, or 100. Use null if not mentioned.",
    )
    priority: str | None = Field(
        default=None,
        description="One of LOW, MEDIUM, HIGH, URGENT. Use null if not mentioned.",
    )
    is_confirmation: bool = Field(
        default=False,
        description="True if the user is saying yes/confirming a previous proposal.",
    )
    is_rejection: bool = Field(
        default=False,
        description="True if the user is saying no/cancelling a proposed booking.",
    )


_SYSTEM = (
    "You extract booking slot values from a user message in a BA resource management system. "
    "Return STRICT JSON. Do NOT invent values not present in the text. "
    "capacity_percent MUST be one of 25, 50, 75, 100 or null. "
    "Never invent BA names or project names not mentioned."
)


def _last_human_text(state: ChatState) -> str:
    for msg in reversed(state.get("messages", [])):
        if getattr(msg, "type", None) == "human" and isinstance(msg.content, str):
            return msg.content.strip()
    return ""


def _conversation_context(state: ChatState) -> str:
    lines: list[str] = []
    for msg in state.get("messages", [])[-8:]:
        role = getattr(msg, "type", "")
        text = msg.content if isinstance(msg.content, str) else ""
        if text:
            lines.append(f"{role}: {text[:300]}")
    return "\n".join(lines)


async def extract_slots(state: ChatState) -> ChatState:
    text = _last_human_text(state)
    existing: dict = dict(state.get("slots") or {})
    missing_slots = state.get("missing_slots") or []
    awaiting = state.get("awaiting_user")

    # Detect simple yes/no replies up front (works even without LLM).
    if awaiting == "confirmation":
        lowered = text.lower().strip()
        if lowered in ("yes", "y", "yep", "yeah", "submit", "go", "go ahead", "confirm", "ok", "okay"):
            return {"slots": existing, "confirmed": True}
        if lowered in ("no", "n", "nope", "cancel", "stop", "abort"):
            return {
                "slots": {},
                "confirmed": False,
                "intent": "unknown",
                "awaiting_user": None,
                "missing_slots": [],
            }

    # 1. Deterministic date resolution
    start, end = parse_relative(text)
    if start and not existing.get("start_date"):
        existing["start_date"] = start
    if end and not existing.get("end_date"):
        existing["end_date"] = end

    # 2. Fallback: when we asked a specific field, treat the reply as the answer
    #    for that field (works without an LLM).
    if awaiting == "clarification" and missing_slots:
        first_missing = missing_slots[0]
        if first_missing not in ("start_date", "end_date") and not existing.get(first_missing):
            # Only apply the raw reply when it looks like a single-field answer
            # (short text, no other slots embedded). If the LLM is available it
            # will override this with a more precise extraction below.
            if len(text.split(",")) <= 2 and len(text) < 200:
                value = _coerce_field_value(first_missing, text)
                if value is not None:
                    existing[first_missing] = value

    # 3. LLM slot extraction (best-effort)
    user_prompt = (
        f"Conversation:\n{_conversation_context(state)}\n\n"
        f"Latest message: {text!r}\n\n"
        "Extract slot values. Return JSON."
    )
    try:
        extracted = await call_json(
            system=_SYSTEM,
            user=user_prompt,
            schema=_SlotExtraction,
        )
    except LLMUnavailable as exc:
        log.info("extract_slots: LLM unavailable, using deterministic path: %s", exc)
        return {"slots": existing, "confirmed": False}

    if extracted.is_confirmation:
        return {"slots": existing, "confirmed": True}
    if extracted.is_rejection:
        return {
            "slots": {},
            "confirmed": False,
            "intent": "unknown",
            "awaiting_user": None,
            "missing_slots": [],
        }

    if extracted.project_name and not existing.get("project_id") and not existing.get("project_name"):
        existing["project_name"] = extracted.project_name
    if extracted.ba_name and not existing.get("ba_id") and not existing.get("ba_name"):
        existing["ba_name"] = extracted.ba_name
    if extracted.title and not existing.get("title"):
        existing["title"] = extracted.title
    if extracted.description and not existing.get("description"):
        existing["description"] = extracted.description
    if extracted.capacity_percent in _CAPACITY_VALUES and not existing.get("capacity_percent"):
        existing["capacity_percent"] = extracted.capacity_percent
    if extracted.priority and not existing.get("priority"):
        existing["priority"] = extracted.priority

    return {"slots": existing, "confirmed": False}


def _coerce_field_value(field: str, text: str) -> str | int | None:
    """Best-effort field coercion when we know which field we asked about."""

    cleaned = text.strip()
    if not cleaned:
        return None
    if field == "capacity_percent":
        # Pull first number, snap to allowed values.
        import re

        match = re.search(r"\d+", cleaned)
        if not match:
            return None
        value = int(match.group(0))
        return value if value in _CAPACITY_VALUES else None
    # For project_name, title, description: take the user's reply verbatim.
    return cleaned
