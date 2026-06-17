"""Per-node safety wrapper.

LangGraph doesn't have a built-in error boundary: an unhandled exception
inside a node propagates up through ``astream``/``ainvoke`` and crashes the
whole graph run. For the SSE chat stream that means the user sees a generic
"chat stream failed" event and the turn is lost — even if the failure was
local to one node and the rest of the graph could have recovered.

``safe_node`` wraps each async node so any unexpected exception is logged,
streamed to the UI as a friendly message, and converted into a state patch
that gracefully ends the turn:

* ``messages``: an ``AIMessage`` describing the failure (no stack traces).
* ``error``: the string form of the exception, for downstream nodes that
  inspect it (e.g. ``summarize_metrics._no_data_message``).
* ``awaiting_user``: cleared so the user isn't stuck mid-flow.
* ``confirmed``: forced to False so a partial booking can't accidentally
  proceed to the write node.

Nodes that already handle their own errors keep working: they return a
state patch and never raise, so the wrapper is a pure passthrough.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.state import ChatState

log = logging.getLogger(__name__)

NodeFn = Callable[[ChatState], Awaitable[ChatState]]


# Per-node fallback messages. Keep them short, user-facing, and free of
# implementation detail — the raw exception goes to the log, not the user.
_FALLBACK_MESSAGES: dict[str, str] = {
    "router": "I had trouble understanding that. Could you rephrase?",
    "retrieve_metrics": "I couldn't load that data right now. Please try again in a moment.",
    "summarize_metrics": "I loaded the data but couldn't summarise it. Please try again in a moment.",
    "respond": "Something went wrong on my side. Please try again.",
    "extract_slots": "I couldn't read the booking details from that message. Could you rephrase?",
    "validate_slots": "I couldn't validate the booking details. Please try again.",
    "ask_missing": "I lost track of which detail to ask for next. Let's start over — what would you like to book?",
    "pick_write_mode": "I couldn't decide how to file this booking. Please try again.",
    "fetch_recommendations": "I couldn't fetch BA recommendations right now. You can still pick a BA manually.",
    "simulate_capacity": "I couldn't check capacity right now. Proceed with caution.",
    "confirm": "I couldn't render the confirmation card. Please try again.",
    "submit_booking": "I couldn't submit the booking. Please try again or contact support.",
}

_DEFAULT_FALLBACK = "Something went wrong on my side. Please try again."


def safe_node(fn: NodeFn, *, name: str | None = None) -> NodeFn:
    """Wrap a node so unhandled exceptions become a graceful AIMessage.

    The wrapper preserves the original function name so LangGraph traces
    still show the right node id.
    """

    node_name = name or getattr(fn, "__name__", "node")

    async def wrapper(state: ChatState) -> ChatState:
        try:
            return await fn(state)
        except Exception as exc:  # noqa: BLE001 — this IS the boundary
            log.exception("node %s crashed: %s", node_name, exc)
            text = _FALLBACK_MESSAGES.get(node_name, _DEFAULT_FALLBACK)
            await _stream_chunks(text)
            patch: ChatState = {
                "messages": [AIMessage(content=text)],
                "error": str(exc) or exc.__class__.__name__,
                "awaiting_user": None,
                "confirmed": False,
            }
            # Keep slot state intact for nodes where losing it would be
            # frustrating mid-flow. Nodes that need a clean slate (post-
            # submit, rejection) handle that in their happy path already.
            return patch

    wrapper.__name__ = node_name
    return wrapper


async def _stream_chunks(text: str, *, chunk_size: int = 16) -> None:
    """Stream the fallback message so the UI sees progressive text instead
    of a sudden batch render at the end of the failed turn."""

    try:
        writer = get_stream_writer()
    except Exception:  # pragma: no cover — outside a streaming context
        return
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        try:
            writer({"type": "token", "text": text[i : i + chunk_size]})
            # Yield to the event loop so each chunk flushes to the SSE stream
            # instead of buffering until the generator returns.
            await asyncio.sleep(0)
        except Exception:  # pragma: no cover — writer is best-effort
            return
