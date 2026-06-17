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
import re
import uuid
import time
import httpx
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
from ba_chat.guardrails import check_input, check_output
from ba_chat.log_context import tool_calls_var

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


async def send_chat_log(
    thread_id: str,
    feature_name: str,
    user_message: str,
    assistant_message: str,
    status: str,
    duration_ms: int,
    tool_calls: list[dict[str, Any]],
    auth_header: str | None,
    error_msg: str | None = None,
) -> None:
    settings = get_settings()
    headers = {"Content-Type": "application/json"}
    if auth_header:
        headers["Authorization"] = auth_header

    # Estimate token counts (1 token ≈ 4 characters)
    tok_in = len(user_message) // 4
    tok_out = len(assistant_message) // 4 if assistant_message else 0

    model_name = settings.deepseek_model
    prompt_version = os.getenv("BA_CHAT_PROMPT_VERSION", "v1.0.0")

    payload = {
        "session_id": thread_id,
        "feature_name": feature_name,
        "user_message": user_message,
        "assistant_message": assistant_message,
        "status": status,
        "duration_ms": duration_ms,
        "token_input": tok_in,
        "token_output": tok_out,
        "model_name": model_name,
        "prompt_version": prompt_version,
        "tool_calls": tool_calls,
        "error": error_msg,
    }

    url = f"{settings.api_base_url}/api/ai/chat/log"
    try:
        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(url, json=payload, headers=headers)
            if res.status_code >= 300:
                log.warning(
                    "failed to send chat log to Go: %d %s",
                    res.status_code,
                    res.text[:200],
                )
    except Exception as exc:
        log.warning("failed to send chat log to Go: %s", exc)


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
    # Check input against guardrails before processing
    guard_check = await check_input(req.message)
    if not guard_check["allowed"]:
        # Return blocked response immediately
        blocked_text = guard_check["block_message"]
        
        async def blocked_stream() -> AsyncIterator[bytes]:
            yield _sse("ready", {"thread_id": req.thread_id or str(uuid.uuid4())})
            await asyncio.sleep(0)
            yield _sse("state", {"intent": "blocked", "analyze_target": None})
            await asyncio.sleep(0)
            
            # Stream the blocked message word by word
            word_buffer = ""
            for word in blocked_text.split():
                word_buffer += word + " "
                yield _sse("token", {"text": word + " "})
                await asyncio.sleep(0)
            
            await asyncio.sleep(0)
            yield _sse("final", {
                "content": blocked_text,
                "thread_id": req.thread_id or str(uuid.uuid4()),
            })
        
        return StreamingResponse(
            blocked_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {
        "messages": [HumanMessage(content=req.message)],
        "user_id": req.user_id,
        "user_role": req.user_role,
        "auth_header": req.auth_header,
    }

    async def event_stream() -> AsyncIterator[bytes]:
        # Set the ContextVar inside the generator context where the stream runs
        tool_calls_token = tool_calls_var.set([])
        start_time = time.time()

        yield _sse("ready", {"thread_id": thread_id})
        # Yield control to ensure the ready event flushes before processing
        await asyncio.sleep(0)
        final_text = ""
        final_msg: AIMessage | None = None
        sent_state = False
        # Word buffer: accumulate sub-word tokens from the LLM and emit
        # complete words for clean word-by-word SSE streaming.
        word_buffer = ""
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
                            word_buffer += delta
                            # Emit at word boundaries (space, newline, or
                            # punctuation followed by whitespace) so the UI
                            # paints whole words instead of sub-word tokens.
                            m = re.search(r'\s', word_buffer)
                            while m:
                                split_at = m.end()
                                word_chunk = word_buffer[:split_at]
                                word_buffer = word_buffer[split_at:]
                                yield _sse("token", {"text": word_chunk})
                                await asyncio.sleep(0)
                                m = re.search(r'\s', word_buffer)
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
                            # Give state info a quick yield
                            sent_state = True
                            await asyncio.sleep(0)
                    messages = chunk.get("messages") or []
                    for msg in reversed(messages):
                        if isinstance(msg, AIMessage) and isinstance(msg.content, str):
                            if msg.content.strip():
                                final_msg = msg
                                break
            # Flush any remaining buffered text before the final event
            if word_buffer:
                yield _sse("token", {"text": word_buffer})
                word_buffer = ""
                await asyncio.sleep(0)
            
            # Check output safety before sending final
            if final_msg is not None:
                if not final_text.strip():
                    final_text = str(final_msg.content)
                
                # Safety check on output
                if not check_output(final_text):
                    log.warning("Unsafe content detected in LLM output, blocking")
                    final_text = "I apologize, but I cannot provide that information. Let me help you with business-related questions instead."
                
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
                # Safety check on output
                if not check_output(final_text):
                    log.warning("Unsafe content detected in LLM output, blocking")
                    final_text = "I apologize, but I cannot provide that information. Let me help you with business-related questions instead."
                yield _sse("final", {"content": final_text, "thread_id": thread_id})

            # Send chat logs to Go API on success
            duration_ms = int((time.time() - start_time) * 1000)
            collected_tool_calls = tool_calls_var.get() or []
            tool_calls_var.reset(tool_calls_token)

            feature_name = (
                "AI_BAMGR_CHATBOT"
                if req.user_role in ("BA_MANAGER", "ADMIN")
                else "AI_PMPO_CHATBOT"
            )
            asyncio.create_task(
                send_chat_log(
                    thread_id=thread_id,
                    feature_name=feature_name,
                    user_message=req.message,
                    assistant_message=final_text,
                    status="SUCCESS" if final_text else "FAILED",
                    duration_ms=duration_ms,
                    tool_calls=collected_tool_calls,
                    auth_header=req.auth_header,
                )
            )

        except Exception as exc:  # pragma: no cover - safety net for streamed errors
            log.exception("chat stream failed")
            # Flush remaining buffer on error too
            if word_buffer:
                yield _sse("token", {"text": word_buffer})
            yield _sse("error", {"message": str(exc)})

            # Send chat logs to Go API on failure
            duration_ms = int((time.time() - start_time) * 1000)
            collected_tool_calls = tool_calls_var.get() or []
            tool_calls_var.reset(tool_calls_token)

            feature_name = (
                "AI_BAMGR_CHATBOT"
                if req.user_role in ("BA_MANAGER", "ADMIN")
                else "AI_PMPO_CHATBOT"
            )
            asyncio.create_task(
                send_chat_log(
                    thread_id=thread_id,
                    feature_name=feature_name,
                    user_message=req.message,
                    assistant_message=final_text,
                    status="FAILED",
                    duration_ms=duration_ms,
                    tool_calls=collected_tool_calls,
                    auth_header=req.auth_header,
                    error_msg=str(exc),
                )
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
