"""submit_booking — gated write node.

This node is the ONLY one that mutates data. It's always placed behind
``interrupt_before`` in the graph compilation so the user's explicit "yes"
is the only path that triggers it.
"""

from __future__ import annotations

import logging

from langchain_core.messages import AIMessage

from ba_chat.state import ChatState
from ba_chat.tools.booking import APIError, create_booking_direct, create_booking_request

log = logging.getLogger(__name__)


async def submit_booking(state: ChatState) -> ChatState:
    """Call the write endpoint and return the result."""

    slots = state.get("slots") or {}
    auth = state.get("auth_header")
    write_mode = state.get("write_mode") or "request"

    # Build the payload matching Go's bookingInput
    payload: dict = {}
    for key in (
        "ba_id", "project_id", "project_name", "title", "description",
        "notes", "required_skill_ids", "start_date", "end_date",
        "capacity_percent", "priority", "manager_comment",
    ):
        value = slots.get(key)
        if value is not None:
            payload[key] = value

    try:
        if write_mode == "direct":
            result = await create_booking_direct(payload, auth_header=auth)
        else:
            result = await create_booking_request(payload, auth_header=auth)
    except APIError as exc:
        log.warning("submit_booking failed: %s", exc)
        return {
            "messages": [AIMessage(content=f"⚠️ **Booking failed**: =={exc.message}==")],
            "error": exc.message,
            "confirmed": False,
            "awaiting_user": None,
        }

    # Success
    booking = result.get("booking") or result
    booking_id = booking.get("id", "?")
    status = booking.get("status", write_mode.upper())
    warning = result.get("warning")

    lines = [
        f"✓ **Booking created** (ID: `{booking_id}`, status: =={status}==)"
    ]
    if warning:
        lines.append(f"⚠️ Note: =={_format_warning(warning)}==")
    lines.append("")
    lines.append("Anything else I can help with?")

    return {
        "messages": [AIMessage(content="\n".join(lines))],
        "submit_warning": warning,
        "confirmed": False,
        "awaiting_user": None,
        "slots": {},
        "missing_slots": [],
        "intent": "unknown",
    }


def _format_warning(warning: dict | None) -> str:
    if not warning:
        return ""
    if isinstance(warning, dict):
        msg = warning.get("message") or warning.get("warning") or ""
        if msg:
            return str(msg)
        return str(warning)
    return str(warning)
