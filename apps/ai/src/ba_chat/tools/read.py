"""Read-only tools that wrap the live Ba_Bazaar Go API.

Each function maps to one HTTP route. Keep the signatures narrow — the graph
nodes are easier to reason about when each tool returns a single, well-typed
JSON dict.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ba_chat.config import Settings, get_settings

log = logging.getLogger(__name__)


class APIError(RuntimeError):
    """Raised on non-2xx responses from the Ba_Bazaar API."""

    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


class TransientAPIError(APIError):
    """Subclass for retryable failures: network errors, timeouts, 5xx.

    The graph's RetryPolicy is keyed on this type, so 4xx/permanent failures
    (raised as plain ``APIError``) skip retry and fall through to the node's
    own error path immediately.
    """


async def _get(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    auth_header: str | None = None,
    settings: Settings | None = None,
) -> Any:
    settings = settings or get_settings()
    headers = {"Accept": "application/json"}
    token = auth_header or settings.api_token
    if token:
        headers["Authorization"] = (
            token if token.lower().startswith("bearer ") else f"Bearer {token}"
        )
    timeout = httpx.Timeout(settings.request_timeout_seconds, connect=5.0)
    url = f"{settings.api_base_url}{path}"
    log.debug("GET %s params=%s", url, params)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, params=params, headers=headers)
    except httpx.TimeoutException as exc:
        # Go-side LLM summary endpoints can take up to ~45s when DeepSeek is
        # slow. Raise as TransientAPIError so the graph's RetryPolicy retries
        # this node before degrading to the no-data path.
        log.warning("GET %s timed out after %ss: %s", url, settings.request_timeout_seconds, exc)
        raise TransientAPIError(
            504, f"upstream timed out after {settings.request_timeout_seconds:.0f}s"
        ) from exc
    except httpx.HTTPError as exc:
        # Connection refused, DNS, TLS, read errors — all retryable.
        log.warning("GET %s failed: %s", url, exc)
        raise TransientAPIError(502, f"upstream request failed: {exc}") from exc
    if response.status_code >= 500:
        # 5xx: upstream is broken, worth retrying.
        raise TransientAPIError(response.status_code, response.text[:300])
    if response.status_code >= 300:
        # 4xx: bad input / auth / not found — retrying won't help.
        raise APIError(response.status_code, response.text[:300])
    if not response.content:
        return {}
    return response.json()


# ---------------------------------------------------------------------------
# Manager dashboard / analytics
# ---------------------------------------------------------------------------


async def get_manager_summary(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    """Plain JSON facts (no LLM)."""

    return await _get(
        "/api/dashboard/manager-summary",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


async def get_manager_summary_llm(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    """Server-side grounded summary already produced by `llm_summary.go`."""

    return await _get(
        "/api/dashboard/manager-summary/llm",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


async def get_action_center_llm(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    return await _get(
        "/api/bookings/action-center/llm-summary",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


async def get_my_schedule_llm(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    return await _get(
        "/api/bookings/my-schedule/llm-summary",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


async def get_reports_llm(
    *, month: str | None = None, auth_header: str | None = None
) -> dict:
    return await _get(
        "/api/reports/summary/llm",
        params={"month": month},
        auth_header=auth_header,
    )


async def get_team_utilization(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    return await _get(
        "/api/analytics/team-utilization",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


async def get_project_effort(
    *, frm: str | None = None, to: str | None = None, auth_header: str | None = None
) -> dict:
    return await _get(
        "/api/analytics/project-effort",
        params={"from": frm, "to": to},
        auth_header=auth_header,
    )


# Future slices (kept here so the import surface stays stable when slice 2
# lands). These call existing endpoints and need no schema changes.
async def list_projects(*, auth_header: str | None = None) -> list[dict]:
    return await _get("/api/projects", auth_header=auth_header)


async def list_bas(*, auth_header: str | None = None) -> list[dict]:
    return await _get("/api/ba", auth_header=auth_header)


async def list_skill_tags(*, auth_header: str | None = None) -> list[dict]:
    return await _get("/api/tags", auth_header=auth_header)
