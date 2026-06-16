"""retrieve_metrics — pull facts from the Go API based on `analyze_target`.

Pure tool node. We do not summarise here; that's the next node's job. Output
is the raw JSON dict the API returns, stored on `state['metrics']`.
"""

from __future__ import annotations

import logging

from ba_chat.state import ChatState
from ba_chat.tools.read import (
    APIError,
    get_action_center_llm,
    get_manager_summary,
    get_my_schedule_llm,
    get_reports_llm,
)

log = logging.getLogger(__name__)


async def retrieve_metrics(state: ChatState) -> ChatState:
    target = state.get("analyze_target") or "manager_dashboard"
    auth = state.get("auth_header")
    try:
        if target == "action_center":
            metrics = await get_action_center_llm(auth_header=auth)
        elif target == "my_schedule":
            metrics = await get_my_schedule_llm(auth_header=auth)
        elif target == "reports":
            metrics = await get_reports_llm(auth_header=auth)
        else:  # manager_dashboard
            # We hit the deterministic endpoint here; summary prose is added
            # downstream by `summarize_metrics`. This keeps the analyze path
            # workable even when the Go-side LLM cache is cold.
            metrics = await get_manager_summary(auth_header=auth)
    except APIError as exc:
        log.warning("retrieve_metrics: api error %s", exc)
        return {"metrics": None, "error": exc.message}

    return {"metrics": metrics, "error": None}
