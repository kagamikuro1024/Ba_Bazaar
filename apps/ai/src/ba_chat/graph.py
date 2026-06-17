"""LangGraph wiring (slices 1-4).

Read-only analyze:
    router → retrieve_metrics → summarize_metrics → END

Booking creation:
    router → extract_slots → validate_slots
              ├─missing→ ask_missing → END (turn ends, awaits user)
              ├─complete→ pick_write_mode → fetch_recommendations
              │                      → simulate_capacity
              │                      → confirm → END
              ├─cancelled→ cancelled → END
              └─side_question→ side_chat → END (answer off-topic, resume next turn)

Submit (gated):
    router (sees confirmed=True) → submit_booking → END

`submit_booking` lives behind ``interrupt_before`` — only an explicit user
"yes" sets ``confirmed=True`` and triggers the write.
"""

from __future__ import annotations

from typing import Literal

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from langgraph.types import RetryPolicy

from ba_chat.llm import LLMUnavailable
from ba_chat.nodes import (
    ask_missing,
    cancelled,
    confirm,
    extract_slots,
    fetch_recommendations,
    pick_write_mode,
    respond,
    retrieve_metrics,
    router,
    side_chat,
    simulate_capacity,
    submit_booking,
    summarize_metrics,
    validate_slots,
)
from ba_chat.nodes._safe import safe_node
from ba_chat.state import ChatState
from ba_chat.tools.read import TransientAPIError


# Retry transient upstream failures (Go-API timeouts, 5xx, network blips,
# DeepSeek hiccups) before giving up. Permanent failures (4xx, bad input)
# still fall through to the next node which renders a friendly error.
#
# Default: 3 attempts × 0.5s backoff × 2.0 factor + jitter, max 8s between
# tries. That covers ~5-15s of transient pain without piling more load on a
# struggling upstream.
_TRANSIENT_RETRY = RetryPolicy(
    max_attempts=3,
    initial_interval=0.5,
    backoff_factor=2.0,
    max_interval=8.0,
    jitter=True,
    retry_on=(TransientAPIError, LLMUnavailable),
)

# Extraction nodes (router, extract_slots) already self-retry the LLM call
# inside the node via call_json_with_retry. We still keep a graph-level
# safety net here in case the inner retry exits with a different error class
# (e.g. a propagated TransientAPIError) so the whole node can re-run once.
_EXTRACTION_RETRY = RetryPolicy(
    max_attempts=2,
    initial_interval=1.0,
    backoff_factor=2.0,
    max_interval=4.0,
    jitter=True,
    retry_on=(TransientAPIError, LLMUnavailable),
)


def _route_after_router(
    state: ChatState,
) -> Literal["retrieve_metrics", "extract_slots", "submit_booking", "respond", "cancelled"]:
    intent = state.get("intent", "unknown")
    # If the previous turn ended in cancellation, an empty follow-up shouldn't
    # immediately re-enter the booking flow.
    if state.get("cancelled"):
        return "respond"
    # If user just confirmed, go straight to submit (interrupt_before catches it).
    if state.get("confirmed"):
        return "submit_booking"
    if intent == "analyze":
        return "retrieve_metrics"
    if intent in ("create_booking", "modify_booking"):
        return "extract_slots"
    return "respond"


def _route_after_extract(
    state: ChatState,
) -> Literal["submit_booking", "validate_slots", "cancelled", "side_chat"]:
    """Route after slot extraction.

    * side_reply → stream the LLM's contextual reply and end the turn
    * cancelled → render the cancellation message and end the turn
    * confirmed → straight to the gated submit node
    * otherwise → validate what we have and ask for the next missing field
    """

    if state.get("side_reply_text"):
        return "side_chat"
    if state.get("cancelled"):
        return "cancelled"
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
    # IO-bound nodes get a retry_policy so transient upstream failures
    # (timeouts, 5xx, DeepSeek hiccups) retry the SAME node with backoff
    # before falling through. submit_booking is intentionally NOT retried —
    # write retries can create duplicate bookings.
    #
    # Every node is also wrapped in `safe_node` so that if retries are
    # exhausted (or an extractor truly cannot get the info it needs), the
    # turn ends with a friendly AIMessage instead of crashing the SSE stream.
    # analyze
    builder.add_node("router", safe_node(router, name="router"), retry_policy=_EXTRACTION_RETRY)
    builder.add_node(
        "retrieve_metrics",
        safe_node(retrieve_metrics, name="retrieve_metrics"),
        retry_policy=_TRANSIENT_RETRY,
    )
    builder.add_node(
        "summarize_metrics",
        safe_node(summarize_metrics, name="summarize_metrics"),
        retry_policy=_TRANSIENT_RETRY,
    )
    builder.add_node("respond", safe_node(respond, name="respond"))
    # booking
    builder.add_node(
        "extract_slots",
        safe_node(extract_slots, name="extract_slots"),
        retry_policy=_EXTRACTION_RETRY,
    )
    builder.add_node("validate_slots", safe_node(validate_slots, name="validate_slots"))
    builder.add_node("ask_missing", safe_node(ask_missing, name="ask_missing"))
    builder.add_node("pick_write_mode", safe_node(pick_write_mode, name="pick_write_mode"))
    builder.add_node(
        "fetch_recommendations",
        safe_node(fetch_recommendations, name="fetch_recommendations"),
        retry_policy=_TRANSIENT_RETRY,
    )
    builder.add_node(
        "simulate_capacity",
        safe_node(simulate_capacity, name="simulate_capacity"),
        retry_policy=_TRANSIENT_RETRY,
    )
    builder.add_node("confirm", safe_node(confirm, name="confirm"))
    # never retry writes — duplicate bookings are worse than a failed turn
    builder.add_node("submit_booking", safe_node(submit_booking, name="submit_booking"))
    # cancellation terminus — renders a friendly "no problem" and ends the turn
    builder.add_node("cancelled", safe_node(cancelled, name="cancelled"))
    # off-flow reply — streams the LLM's contextual answer and ends the turn
    builder.add_node("side_chat", safe_node(side_chat, name="side_chat"))

    builder.add_edge(START, "router")
    builder.add_conditional_edges(
        "router",
        _route_after_router,
        {
            "retrieve_metrics": "retrieve_metrics",
            "extract_slots": "extract_slots",
            "submit_booking": "submit_booking",
            "respond": "respond",
            "cancelled": "cancelled",
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
            "cancelled": "cancelled",
            "side_chat": "side_chat",
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
    builder.add_edge("cancelled", END)
    builder.add_edge("side_chat", END)
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
