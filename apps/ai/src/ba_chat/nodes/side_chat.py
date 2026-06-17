"""side_chat — terminal node for off-flow user replies.

When ``extract_slots`` flags a turn as ``side_question`` the LLM has already
produced a contextual reply. This node just streams it to the UI and ends
the turn while keeping the booking slots intact, so the next user message
resumes the slot-fill exactly where they left off.
"""

from __future__ import annotations

import asyncio

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.state import ChatState


_FALLBACK = (
    "Got it — let me know when you'd like to continue with the booking."
)


async def side_chat(state: ChatState) -> ChatState:
    text = (state.get("side_reply_text") or _FALLBACK).strip() or _FALLBACK
    await _stream_chunks(text)
    return {
        "messages": [AIMessage(content=text)],
        # Clear the marker so we don't re-emit on the next turn.
        "side_reply_text": None,
        # Re-arm the awaiting flag so the next user message routes back into
        # the booking flow at the same field. If we weren't mid-clarification,
        # leave it as-is.
        "awaiting_user": state.get("awaiting_user") or "clarification",
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
