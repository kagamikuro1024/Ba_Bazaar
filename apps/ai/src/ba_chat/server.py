"""FastAPI SSE server.

Exposes a single endpoint:

  POST /chat
    body: {"message": "...", "thread_id": "...", "auth_header": "Bearer ..."}

It streams Server-Sent Events:
  event: token   data: <delta>
  event: state   data: {"intent": "...", "analyze_target": "..."}
  event: final   data: {"content": "<full markdown>"}
  event: error   data: {"message": "..."}

Built thin on purpose — the React side already knows how to render Markdown
via `AISummaryCard`, so we just stream the raw text in.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field

from ba_chat.config import get_settings
from ba_chat.graph import compile_graph

log = logging.getLogger(__name__)


app = FastAPI(title="ba-chat", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One graph instance per process. Checkpointer is in-memory; production uses
# PostgresSaver — see graph.compile_graph for the swap point.
_graph = compile_graph()


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    thread_id: str | None = None
    auth_header: str | None = None
    user_role: str = "BA_MANAGER"
    user_id: str = "web"


@app.get("/health")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ba-chat",
        "api_base_url": settings.api_base_url,
        "llm": settings.has_llm,
    }


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {
        "messages": [HumanMessage(content=req.message)],
        "user_id": req.user_id,
        "user_role": req.user_role,
        "auth_header": req.auth_header,
    }

    async def event_stream() -> AsyncIterator[bytes]:
        yield _sse("ready", {"thread_id": thread_id})
        final_text = ""
        final_msg: AIMessage | None = None
        sent_state = False
        try:
            async for stream_mode, raw_chunk in _graph.astream(
                inputs,
                config=config,  # type: ignore[arg-type]
                stream_mode=["custom", "values"],
            ):
                if stream_mode == "custom":
                    chunk = raw_chunk if isinstance(raw_chunk, dict) else {}
                    if chunk.get("type") == "token":
                        delta = str(chunk.get("text") or "")
                        if delta:
                            final_text += delta
                            yield _sse("token", {"text": delta})
                            # Give the browser/React a chance to paint. Without
                            # this, short static replies can arrive in one TCP
                            # burst and look like a batch update.
                            await asyncio.sleep(0.025)
                elif stream_mode == "values":
                    chunk = raw_chunk if isinstance(raw_chunk, dict) else {}
                    if not sent_state and "intent" in chunk:
                        intent = chunk.get("intent")
                        target = chunk.get("analyze_target")
                        if intent:
                            yield _sse(
                                "state",
                                {"intent": intent, "analyze_target": target},
                            )
                            sent_state = True
                    messages = chunk.get("messages") or []
                    for msg in reversed(messages):
                        if isinstance(msg, AIMessage) and isinstance(msg.content, str):
                            if msg.content.strip():
                                final_msg = msg
                                break
            # End of stream — flush the final AI message + buttons.
            if final_msg is not None:
                if not final_text.strip():
                    final_text = final_msg.content
                action_buttons = final_msg.additional_kwargs.get("action_buttons")
                action_field = final_msg.additional_kwargs.get("action_field")
                final_payload: dict[str, Any] = {
                    "content": final_text,
                    "thread_id": thread_id,
                }
                if action_buttons:
                    final_payload["action_buttons"] = action_buttons
                if action_field:
                    final_payload["action_field"] = action_field
                yield _sse("final", final_payload)
            else:
                yield _sse("final", {"content": final_text, "thread_id": thread_id})
        except Exception as exc:  # pragma: no cover - safety net for streamed errors
            log.exception("chat stream failed")
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _sse(event: str, payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n".encode("utf-8")


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    host = os.getenv("BA_CHAT_HOST", "0.0.0.0")
    port = int(os.getenv("BA_CHAT_PORT", "8000"))
    uvicorn.run("ba_chat.server:app", host=host, port=port, reload=False)


# Quiet ruff about asyncio import without usage (kept for future websockets path)
_ = asyncio


if __name__ == "__main__":
    main()
