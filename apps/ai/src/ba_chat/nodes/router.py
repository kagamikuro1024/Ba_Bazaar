"""Router node — classifies user intent and (for analyze) picks a target.

Slice 1 only routes between `analyze`, `smalltalk`, and `unknown`. Future
slices add `create_booking`, `modify_booking`, `approve_reject` without
changing this node's signature.

The router uses DeepSeek's JSON-mode for structured output. When DeepSeek is
unreachable we fall back to a tiny keyword classifier so the graph still
runs in offline / CI contexts.
"""

from __future__ import annotations

import logging
import re
from typing import Literal, get_args

from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field, field_validator

from ba_chat.llm import LLMUnavailable, call_json_with_retry
from ba_chat.state import AnalyzeTarget, ChatState, Intent

log = logging.getLogger(__name__)

# Slice 1+3: read-only intents PLUS booking-creation intents.
_AvailableIntent = Literal[
    "analyze", "create_booking", "modify_booking", "smalltalk", "unknown"
]
_AVAILABLE_INTENTS = set(get_args(_AvailableIntent))
_AVAILABLE_TARGETS = set(get_args(AnalyzeTarget))


class _RouteDecision(BaseModel):
    intent: _AvailableIntent
    analyze_target: str | None = Field(
        default=None,
        description=(
            "Which Ba_Bazaar surface to summarise. Required when intent='analyze'. "
            "manager_dashboard for team-wide metrics, action_center for pending/urgent "
            "requests, my_schedule for the current user's bookings, reports for "
            "monthly utilization."
        ),
    )

    @field_validator("analyze_target", mode="before")
    @classmethod
    def _coerce_analyze_target(cls, value: object) -> str | None:
        if isinstance(value, str) and value in _AVAILABLE_TARGETS:
            return value
        return None


_SYSTEM = (
    "You are the routing component of a Ba_Bazaar manager assistant. Read the "
    "latest user message in context and emit STRICT JSON matching the schema. "
    "Do not invent fields. "
    "Use 'analyze' when the user wants to view information about the team, "
    "their workload, dashboards, or reports. "
    "Use 'create_booking' when the user wants to create, schedule, request, or "
    "book BA work (e.g. 'create booking', 'book Linh next week', 'schedule a "
    "BA for Project X'). "
    "Use 'modify_booking' when the user is adjusting a booking already in flight. "
    "Use 'smalltalk' for greetings, thanks, or chit-chat. "
    "Use 'unknown' only when none of the above apply."
)


def _build_prompt(state: ChatState) -> str:
    last = ""
    history: list[str] = []
    for message in state.get("messages", []):
        text = getattr(message, "content", "")
        if not isinstance(text, str):
            continue
        history.append(f"{message.type}: {text}")
        if message.type == "human":
            last = text
    transcript = "\n".join(history[-6:])
    return (
        "Recent conversation:\n"
        f"{transcript}\n\n"
        f"Latest user message: {last!r}\n\n"
        "Return JSON like: "
        '{"intent": "analyze", "analyze_target": "manager_dashboard"}'
    )


async def router(state: ChatState) -> ChatState:
    """Set `state['intent']` and (for analyze) `state['analyze_target']`."""

    last_human = _last_human_message(state)
    if not last_human:
        return {"intent": "unknown", "analyze_target": None}

    # If we're mid-flow (awaiting confirmation or filling slots), keep routing
    # to create_booking so the slot-fill loop continues. The booking flow
    # itself reads is_confirmation/is_rejection from the user's reply.
    awaiting = state.get("awaiting_user")
    if awaiting in ("confirmation", "clarification"):
        return {"intent": "create_booking", "analyze_target": None}

    # Explicit booking commands are high-impact and should not depend on the
    # LLM interpreting prior dashboard context correctly.
    if _is_booking_request(last_human):
        return {"intent": "create_booking", "analyze_target": None}

    try:
        decision = await call_json_with_retry(
            system=_SYSTEM,
            user=_build_prompt(state),
            schema=_RouteDecision,
            node_name="router",
        )
    except LLMUnavailable as exc:
        log.info("router falling back to keywords after retries: %s", exc)
        return _keyword_route(last_human)

    intent: Intent = decision.intent  # type: ignore[assignment]
    target = decision.analyze_target if intent == "analyze" else None
    if intent == "analyze" and target is None:
        target = "manager_dashboard"
    return {"intent": intent, "analyze_target": target}


# ---------------------------------------------------------------------------
# Fallback path
# ---------------------------------------------------------------------------


def _last_human_message(state: ChatState) -> str:
    for message in reversed(state.get("messages", [])):
        if isinstance(message, HumanMessage):
            text = message.content if isinstance(message.content, str) else ""
            if text.strip():
                return text
    return ""


_TARGET_KEYWORDS: dict[AnalyzeTarget, tuple[str, ...]] = {
    "action_center": ("inbox", "pending", "approve", "reject", "action center", "urgent"),
    "my_schedule": ("my schedule", "my bookings", "my work", "my upcoming"),
    "reports": ("report", "monthly", "utilization report", "csv"),
    "manager_dashboard": ("dashboard", "team", "bench", "utilization", "overbook"),
}

_BOOKING_KEYWORDS = (
    "create booking", "create a booking", "create another booking",
    "new booking", "add a booking", "add booking", "make a booking",
    "make booking", "book a", "book ", "schedule ", "assign ",
    "request booking", "request a booking", "book this", "book her", "book him",
    "set up a booking", "open a booking", "log a booking", "raise a booking",
)

_SMALLTALK = re.compile(
    r"^\s*(hi|hello|hey|thanks|thank you|cảm ơn|cam on|chào|chao)\b",
    re.IGNORECASE,
)


def _is_booking_request(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in _BOOKING_KEYWORDS)


def _keyword_route(text: str) -> ChatState:
    if _SMALLTALK.search(text):
        return {"intent": "smalltalk", "analyze_target": None}

    # Booking creation keywords win — they're more specific than analyze ones.
    if _is_booking_request(text):
        return {"intent": "create_booking", "analyze_target": None}

    lowered = text.lower()
    for target, keywords in _TARGET_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return {"intent": "analyze", "analyze_target": target}

    # Default: assume the user wants help with the dashboard. This keeps the
    # bot useful even when DeepSeek is offline; the user can always re-ask.
    if any(word in lowered for word in ("show", "summary", "summarize", "analyze")):
        return {"intent": "analyze", "analyze_target": "manager_dashboard"}
    return {"intent": "unknown", "analyze_target": None}
