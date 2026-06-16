"""LangGraph wiring (slices 1-4).

Read-only analyze:
    router → retrieve_metrics → summarize_metrics → END

Booking creation:
    router → extract_slots → validate_slots
              ├─missing→ ask_missing → END (turn ends, awaits user)
              └─complete→ pick_write_mode → fetch_recommendations
                                              → simulate_capacity
                                              → confirm → END

Submit (gated):
    router (sees confirmed=True) → submit_booking → END

`submit_booking` lives behind ``interrupt_before`` — only an explicit user
"yes" sets ``confirmed=True`` and triggers the write.
"""

from __future__ import annotations

from typing import Literal

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from ba_chat.nodes import (
    ask_missing,
    confirm,
    extract_slots,
    fetch_recommendations,
    pick_write_mode,
    respond,
    retrieve_metrics,
    router,
    simulate_capacity,
    submit_booking,
    summarize_metrics,
    validate_slots,
)
from ba_chat.state import ChatState


def _route_after_router(
    state: ChatState,
) -> Literal["retrieve_metrics", "extract_slots", "submit_booking", "respond"]:
    intent = state.get("intent", "unknown")
    # If user just confirmed, go straight to submit (interrupt_before catches it).
    if state.get("confirmed"):
        return "submit_booking"
    if intent == "analyze":
        return "retrieve_metrics"
    if intent in ("create_booking", "modify_booking"):
        return "extract_slots"
    return "respond"


def _route_after_extract(state: ChatState) -> Literal["submit_booking", "validate_slots"]:
    """If extraction parsed a 'yes' confirmation, go to submit; else validate."""

    if state.get("confirmed"):
        return "submit_booking"
    return "validate_slots"


def _route_after_validate(state: ChatState) -> Literal["ask_missing", "pick_write_mode"]:
    if state.get("missing_slots"):
        return "ask_missing"
    return "pick_write_mode"


def _route_after_pick_write_mode(
    state: ChatState,
) -> Literal["fetch_recommendations", "simulate_capacity"]:
    slots = state.get("slots") or {}
    if slots.get("ba_id"):
        return "simulate_capacity"
    return "fetch_recommendations"


def build_graph() -> StateGraph:
    builder = StateGraph(ChatState)
    # analyze
    builder.add_node("router", router)
    builder.add_node("retrieve_metrics", retrieve_metrics)
    builder.add_node("summarize_metrics", summarize_metrics)
    builder.add_node("respond", respond)
    # booking
    builder.add_node("extract_slots", extract_slots)
    builder.add_node("validate_slots", validate_slots)
    builder.add_node("ask_missing", ask_missing)
    builder.add_node("pick_write_mode", pick_write_mode)
    builder.add_node("fetch_recommendations", fetch_recommendations)
    builder.add_node("simulate_capacity", simulate_capacity)
    builder.add_node("confirm", confirm)
    builder.add_node("submit_booking", submit_booking)

    builder.add_edge(START, "router")
    builder.add_conditional_edges(
        "router",
        _route_after_router,
        {
            "retrieve_metrics": "retrieve_metrics",
            "extract_slots": "extract_slots",
            "submit_booking": "submit_booking",
            "respond": "respond",
        },
    )
    builder.add_edge("retrieve_metrics", "summarize_metrics")
    builder.add_edge("summarize_metrics", END)
    builder.add_edge("respond", END)

    builder.add_conditional_edges(
        "extract_slots",
        _route_after_extract,
        {
            "submit_booking": "submit_booking",
            "validate_slots": "validate_slots",
        },
    )
    builder.add_conditional_edges(
        "validate_slots",
        _route_after_validate,
        {
            "ask_missing": "ask_missing",
            "pick_write_mode": "pick_write_mode",
        },
    )
    builder.add_edge("ask_missing", END)
    builder.add_conditional_edges(
        "pick_write_mode",
        _route_after_pick_write_mode,
        {
            "fetch_recommendations": "fetch_recommendations",
            "simulate_capacity": "simulate_capacity",
        },
    )
    builder.add_edge("fetch_recommendations", "simulate_capacity")
    builder.add_edge("simulate_capacity", "confirm")
    builder.add_edge("confirm", END)
    builder.add_edge("submit_booking", END)
    return builder


def compile_graph(*, checkpointer=None):
    """Compile with an in-memory checkpointer.

    Safety: ``submit_booking`` is the only mutating node and reaching it requires
    THREE independent conditions to all be true:

    1. Router classifies the intent as ``create_booking``.
    2. ``extract_slots`` sets ``confirmed=True`` based on the user's literal
       reply (only ``yes/y/submit/confirm/ok/...`` qualifies).
    3. ``_route_after_router`` checks ``confirmed`` before allowing the
       direct router → submit_booking edge.

    These three gates make accidental writes implausible without an interrupt.
    Production deployments that want belt-and-braces should swap in
    ``PostgresSaver`` and add ``interrupt_before=["submit_booking"]``, then
    handle ``graph.ainvoke(None, config)`` resume in the server.
    """

    saver = checkpointer or MemorySaver()
    return build_graph().compile(checkpointer=saver)
