"""summarize_metrics — produce streaming prose grounded in `state['metrics']`.

Two execution modes:
  * LLM available → call DeepSeek with a strict citation prompt and stream
    deltas back to the caller via LangGraph custom events.
  * LLM unavailable → emit a deterministic template that quotes the same
    numbers. Mirrors the fallback discipline in apps/api/cmd/api/llm_summary.go.

Streaming: as tokens arrive from DeepSeek we emit them via
``get_stream_writer()`` so the SSE server can forward each chunk to the
browser. The accumulated text becomes the final ``AIMessage`` so the
checkpointer sees the complete reply on the next turn.
"""

from __future__ import annotations

import asyncio
import json
import logging

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.config import get_settings
from ba_chat.llm import ChatMessage, LLMUnavailable, stream_chat
from ba_chat.state import ChatState

log = logging.getLogger(__name__)


_SYSTEM = (
    "You are a Ba_Bazaar manager assistant. Summarise the JSON facts in plain "
    "English: 3-5 short bullets, every number quoted exactly from the JSON. "
    "Do not invent BA names, projects, dates, or trends not present in the "
    "facts. Format the reply as Markdown bullets followed by a single closing "
    "sentence. Never wrap output in code fences. "
    "Highlight the key facts the manager should not miss by wrapping them in "
    "double-equals, e.g. ==75%== or ==12 pending==. Highlight numbers, "
    "percentages, dates, BA names, project names, and status flags — pick at "
    "most one or two highlights per bullet so the emphasis stays meaningful. "
    "Use **bold** only for labels (e.g. **Team utilization**), never combine "
    "bold and highlight on the same span."
)


async def summarize_metrics(state: ChatState) -> ChatState:
    metrics = state.get("metrics")
    if not metrics:
        text = _no_data_message(state)
        await _emit_simulated_stream(text)
        return {"messages": [AIMessage(content=text)]}

    settings = get_settings()
    if not settings.has_llm:
        text = _deterministic_summary(state, metrics)
        # Even the deterministic path streams: emit the text in small chunks so
        # the UI feels consistent. Words are a good unit for short markdown.
        await _emit_simulated_stream(text)
        return {"messages": [AIMessage(content=text)]}

    user_prompt = _build_user_prompt(state, metrics)
    chunks: list[str] = []

    try:
        writer = _safe_writer()
        async for delta in stream_chat(
            messages=[
                ChatMessage(role="system", content=_SYSTEM),
                ChatMessage(role="user", content=user_prompt),
            ],
            temperature=0.2,
        ):
            chunks.append(delta)
            if writer is not None:
                writer({"type": "token", "text": delta})
                # Yield to the event loop after each LLM token so the SSE
                # server can flush it to the client immediately.
                await asyncio.sleep(0)
    except LLMUnavailable as exc:
        log.info("summarize_metrics falling back: %s", exc)
        text = _deterministic_summary(state, metrics)
        await _emit_simulated_stream(text)
        return {"messages": [AIMessage(content=text)]}

    text = "".join(chunks).strip()
    if not text:
        text = _deterministic_summary(state, metrics)
        await _emit_simulated_stream(text)
    return {"messages": [AIMessage(content=text)]}


def _safe_writer():
    """get_stream_writer() raises if not in a streaming context — guard it."""

    try:
        return get_stream_writer()
    except Exception:  # pragma: no cover - graceful degradation outside graph
        return None


async def _emit_simulated_stream(text: str, *, chunk_size: int = 8) -> None:
    """Slice the deterministic text into chunks so the UI sees streaming.

    chunk_size is in characters; we don't bother breaking on word boundaries
    because the markdown renderer handles partial words gracefully.
    """

    writer = _safe_writer()
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        writer({"type": "token", "text": text[i : i + chunk_size]})
        # Yield to the event loop so each chunk flushes to the SSE stream
        # instead of buffering until the generator returns.
        await asyncio.sleep(0)


# ---------------------------------------------------------------------------
# Prompt + fallbacks
# ---------------------------------------------------------------------------


def _build_user_prompt(state: ChatState, metrics: dict) -> str:
    target = state.get("analyze_target") or "manager_dashboard"
    last_user = ""
    for message in reversed(state.get("messages", [])):
        if getattr(message, "type", None) == "human" and isinstance(message.content, str):
            last_user = message.content
            break
    facts = json.dumps(metrics, ensure_ascii=False, default=str)
    return (
        f"Surface: {target}\n"
        f"User question: {last_user!r}\n"
        f"Facts JSON:\n{facts}"
    )


def _no_data_message(state: ChatState) -> str:
    err = state.get("error")
    if err:
        return f"I couldn't load that data ({err}). Try again in a moment."
    return "I couldn't find any data for that surface yet."


def _deterministic_summary(state: ChatState, metrics: dict) -> str:
    target = state.get("analyze_target") or "manager_dashboard"
    if target == "manager_dashboard":
        return _summarize_manager_dashboard(metrics)
    if target == "action_center":
        return _summarize_llm_payload(metrics, "Pending actions")
    if target == "my_schedule":
        return _summarize_llm_payload(metrics, "My schedule")
    if target == "reports":
        return _summarize_llm_payload(metrics, "Utilization report")
    return json.dumps(metrics, ensure_ascii=False, indent=2)[:1500]


def _summarize_manager_dashboard(payload: dict) -> str:
    team = payload.get("team", {}) or {}
    actions = payload.get("actions", {}) or {}
    timeframe = payload.get("timeframe", {}) or {}
    bullets = [
        f"- **Timeframe**: =={timeframe.get('from', '?')} → {timeframe.get('to', '?')}==.",
        f"- **Team utilization**: =={team.get('team_utilization_percent', 0)}%== "
        f"across **{team.get('total_ba', 0)}** active BA.",
        f"- **Booked man-days**: =={team.get('total_man_days', 0)}== of "
        f"**{team.get('total_available_man_days', 0)}** available.",
        f"- **Pending requests**: =={actions.get('pending_requests', 0)}== "
        f"(unassigned **{actions.get('unassigned_requests', 0)}**, "
        f"urgent =={actions.get('urgent_requests', 0)}==).",
        f"- **Capacity watchlist**: =={actions.get('overbooked_ba', 0)} overbooked==, "
        f"**{actions.get('bench_ba', 0)}** on bench.",
    ]
    return "\n".join(bullets)


def _summarize_llm_payload(payload: dict, header: str) -> str:
    """Render a server-side llmSummary payload without re-calling DeepSeek."""

    summary = payload.get("summary") or ""
    bullets = payload.get("bullets") or []
    lines: list[str] = [f"**{header}**"]
    if summary:
        lines.append(summary)
    for bullet in bullets[:5]:
        text = bullet.get("text") if isinstance(bullet, dict) else str(bullet)
        if text:
            lines.append(f"- {text}")
    if len(lines) == 1:
        lines.append("(no items in scope)")
    return "\n".join(lines)
