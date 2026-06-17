"""fetch_recommendations + simulate_capacity + confirm nodes."""

from __future__ import annotations

import logging

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

from ba_chat.state import ChatState
from ba_chat.tools.booking import get_recommendations, range_check
from ba_chat.tools.read import APIError

log = logging.getLogger(__name__)


async def fetch_recommendations(state: ChatState) -> ChatState:
    """Call /api/ba/recommendations when ba_id is not yet chosen."""

    slots = state.get("slots") or {}
    auth = state.get("auth_header")
    start = slots.get("start_date", "")
    end = slots.get("end_date", "")
    capacity = slots.get("capacity_percent", 100)

    try:
        candidates = await get_recommendations(
            start_date=start,
            end_date=end,
            capacity_percent=capacity,
            project_id=slots.get("project_id"),
            level=None,
            required_skill_ids=slots.get("required_skill_ids"),
            limit=5,
            auth_header=auth,
        )
    except (APIError, Exception) as exc:
        log.warning("fetch_recommendations failed: %s", exc)
        return {"candidates": [], "error": str(exc)}

    return {"candidates": candidates if isinstance(candidates, list) else [], "error": None}


async def simulate_capacity(state: ChatState) -> ChatState:
    """Call /api/capacity/range-check for the selected BA."""

    slots = state.get("slots") or {}
    auth = state.get("auth_header")
    ba_id = slots.get("ba_id")
    if not ba_id:
        # No BA selected yet — skip simulation
        return {"simulation": None}

    try:
        result = await range_check(
            ba_id=ba_id,
            start_date=slots.get("start_date", ""),
            end_date=slots.get("end_date", ""),
            capacity_percent=slots.get("capacity_percent", 100),
            auth_header=auth,
        )
    except (APIError, Exception) as exc:
        log.warning("simulate_capacity failed: %s", exc)
        return {"simulation": None, "error": str(exc)}

    return {"simulation": result, "error": None}


async def confirm(state: ChatState) -> ChatState:
    """Render a confirmation card for the user to approve or reject."""

    slots = state.get("slots") or {}
    simulation = state.get("simulation")
    candidates = state.get("candidates") or []

    lines = ["**Ready to submit this booking:**", ""]
    project = slots.get('project_name') or slots.get('project_id') or '—'
    lines.append(f"- **Project**: =={project}==")
    if slots.get("ba_id") or slots.get("ba_name"):
        ba_label = slots.get('ba_name') or slots.get('ba_id')
        lines.append(f"- **BA**: =={ba_label}==")
    else:
        lines.append("- **BA**: ==Unassigned== (manager will assign)")
    lines.append(f"- **Dates**: =={slots.get('start_date')} → {slots.get('end_date')}==")
    lines.append(f"- **Capacity**: =={slots.get('capacity_percent')}%==")
    priority = slots.get('priority', 'MEDIUM')
    if priority in ("HIGH", "URGENT"):
        lines.append(f"- **Priority**: =={priority}==")
    else:
        lines.append(f"- **Priority**: {priority}")
    lines.append(f"- **Title**: {slots.get('title')}")
    if slots.get("description"):
        lines.append(f"- **Description**: {slots['description']}")

    if simulation:
        risk = simulation.get("max_risk_capacity", 0)
        risk_after = simulation.get("max_risk_after") or (risk + slots.get("capacity_percent", 0))
        blocking = simulation.get("blocking_day")
        lines.append("")
        if blocking:
            lines.append(
                f"⚠️ **Warning**: Capacity exceeds 100% on =={blocking}== "
                f"(risk =={risk_after}%==)"
            )
        else:
            lines.append(f"✓ Capacity OK — max risk after: =={risk_after}%==")

    if not slots.get("ba_id") and candidates:
        lines.append("")
        lines.append("**Top BA candidates:**")
        for i, c in enumerate(candidates[:3], 1):
            name = c.get("full_name", c.get("ba_id", "?"))
            score = c.get("fit_score", "?")
            lines.append(f"  {i}. =={name}== (fit: =={score}==)")

    lines.append("")
    lines.append("Reply **yes** to submit, **no** to cancel, or tell me what to change.")

    text = "\n".join(lines)
    _stream_chunks(text)

    msg = AIMessage(content=text)
    msg.additional_kwargs["action_buttons"] = [
        {"label": "Yes", "value": "yes"},
        {"label": "No", "value": "no"},
    ]
    msg.additional_kwargs["action_field"] = "confirmation"

    return {
        "messages": [msg],
        "awaiting_user": "confirmation",
    }


def _stream_chunks(text: str, *, chunk_size: int = 12) -> None:
    """Emit a multi-chunk stream for static text so the UI shows progress."""

    try:
        writer = get_stream_writer()
    except Exception:
        return
    if writer is None or not text:
        return
    for i in range(0, len(text), chunk_size):
        writer({"type": "token", "text": text[i : i + chunk_size]})
