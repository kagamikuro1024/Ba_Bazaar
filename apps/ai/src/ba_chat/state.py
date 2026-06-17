"""Graph state schema, kept in sync with the Go API at apps/api/cmd/api.

These types are the contract between every node and the rest of the graph.
Treat them as the source of truth: nodes mutate fields on this dict and the
checkpointer persists them between turns.
"""

from __future__ import annotations

from typing import Annotated, Literal, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Enums (mirroring the Go validation rules)
# ---------------------------------------------------------------------------

Role = Literal["BA", "PM_PO", "BA_MANAGER", "ADMIN", "SUPPORT"]
Priority = Literal["LOW", "MEDIUM", "HIGH", "URGENT"]
CapacityValue = Literal[25, 50, 75, 100]
BAStatus = Literal["ACTIVE", "INACTIVE", "ON_LEAVE"]
BookingStatus = Literal[
    "PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"
]
CapacityLabel = Literal["BENCH", "LOW", "AVAILABLE", "HIGH", "FULL", "OVERBOOKED"]
BALevel = Literal["JUNIOR", "MIDDLE", "SENIOR", "LEAD"]

Intent = Literal[
    "analyze", "create_booking", "modify_booking", "approve_reject", "smalltalk", "unknown"
]
AwaitingUser = Literal["clarification", "confirmation"] | None
WriteMode = Literal["request", "direct"]

# Which existing /llm endpoint or analytics route the analyze path should hit.
# Slice 1 ships the four LLM-summary endpoints already wired in the Go API.
AnalyzeTarget = Literal[
    "manager_dashboard",
    "action_center",
    "my_schedule",
    "reports",
]


# ---------------------------------------------------------------------------
# Booking slot-fill (used in slice 3+)
# ---------------------------------------------------------------------------


class BookingSlots(BaseModel):
    """Mirrors apps/api/cmd/api/booking_handlers.go::bookingInput."""

    ba_id: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    title: str | None = None
    description: str | None = None
    notes: str | None = None
    required_skill_ids: list[str] = Field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None
    capacity_percent: CapacityValue | None = None
    priority: Priority = "MEDIUM"
    manager_comment: str | None = None


class Simulation(BaseModel):
    ba_id: str
    timeframe: dict[str, str]
    max_approved_capacity: int
    max_pending_capacity: int
    max_risk_capacity: int
    max_risk_after: int
    blocking_day: str | None = None
    can_approve: bool


# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------


class ChatState(TypedDict, total=False):
    """Mutable state passed between nodes.

    LangGraph reducers:
      * `messages` accumulates across turns (add_messages).
      * Every other field is replaced wholesale by node return values.
    """

    # conversation
    messages: Annotated[list[BaseMessage], add_messages]

    # routing
    intent: Intent
    analyze_target: AnalyzeTarget | None

    # slot-filling (slice 3+)
    slots: dict
    missing_slots: list[str]
    write_mode: WriteMode | None

    # tool outputs (cached per turn)
    metrics: dict | None
    candidates: list[dict]
    simulation: dict | None
    submit_warning: dict | None

    # control flow
    awaiting_user: AwaitingUser
    confirmed: bool
    cancelled: bool
    # Set by extract_slots when the LLM detects the user said something off-flow
    # (asked a question, switched topic) and produced a contextual reply. The
    # graph short-circuits to side_chat so the assistant can answer without
    # blindly continuing the slot-fill.
    side_reply_text: str | None
    error: str | None

    # auth context (server-side, never sourced from LLM output)
    user_id: str
    user_role: Role
    auth_header: str | None


def empty_state() -> ChatState:
    """Helper used by the CLI/server when starting a fresh thread."""

    return {
        "messages": [],
        "intent": "unknown",
        "analyze_target": None,
        "slots": {},
        "missing_slots": [],
        "write_mode": None,
        "metrics": None,
        "candidates": [],
        "simulation": None,
        "submit_warning": None,
        "awaiting_user": None,
        "confirmed": False,
        "cancelled": False,
        "side_reply_text": None,
        "error": None,
        "user_id": "",
        "user_role": "BA_MANAGER",
        "auth_header": None,
    }
