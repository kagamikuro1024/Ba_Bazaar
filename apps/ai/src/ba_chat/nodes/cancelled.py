"""cancelled — terminal node when the user backs out of a booking flow.

Renders a friendly confirmation that the booking was abandoned and resets
the cancellation flag so the next turn starts clean.
"""

from __future__ import annotations

import asyncio

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.state import ChatState

_CANCELLED_REPLY = (
    "No problem — I've cancelled this booking. Just say 'create booking' "
    "whenever you'd like to start a new one."
)


async def cancelled(state: ChatState) -> ChatState:
    text = _CANCELLED_REPLY
    await _stream_chunks(text)
    return {
        "messages": [AIMessage(content=text)],
        # Reset everything so the next turn is a clean slate.
        "slots": {},
        "missing_slots": [],
        "intent": "unknown",
        "awaiting_user": None,
        "confirmed": False,
        "cancelled": False,
    }


async def _stream_chunks(text: str, *, chunk_size: int = 12) -> None:
    try:
        writer = get_stream_writer()
    except Exception:
        return
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        writer({"type": "token", "text": text[i : i + chunk_size]})
        await asyncio.sleep(0)
