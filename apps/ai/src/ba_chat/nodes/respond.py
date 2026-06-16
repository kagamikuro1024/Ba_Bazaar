"""respond — terminal node for non-analyze intents (smalltalk / unknown).

Streams its reply through the LangGraph custom-event channel so the UI
shows progressive text even for the canned messages.
"""

from __future__ import annotations

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.state import ChatState

_SMALLTALK_REPLY = (
    "Hi — I can summarise the manager dashboard, the action center, your "
    "schedule, or the monthly utilization report. What would you like to "
    "look at?"
)

_UNKNOWN_REPLY = (
    "I'm not sure what you'd like me to do. Try asking, for example, "
    "'show me the manager dashboard' or 'what's pending in the inbox?'."
)


async def respond(state: ChatState) -> ChatState:
    intent = state.get("intent", "unknown")
    text = _SMALLTALK_REPLY if intent == "smalltalk" else _UNKNOWN_REPLY
    _stream_chunks(text)
    return {"messages": [AIMessage(content=text)]}


def _stream_chunks(text: str, *, chunk_size: int = 8) -> None:
    try:
        writer = get_stream_writer()
    except Exception:
        return
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        writer({"type": "token", "text": text[i : i + chunk_size]})
