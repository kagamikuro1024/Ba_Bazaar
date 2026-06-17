"""Write + booking-specific tools that wrap the live Ba_Bazaar Go API.

Separated from read.py because these either mutate state or accept richer
query params. Each function maps 1:1 to a Go route.
"""

from __future__ import annotations

import logging
import time
import json
from typing import Any

import httpx

from ba_chat.config import Settings, get_settings
from ba_chat.http import async_client
from ba_chat.tools.read import APIError, TransientAPIError
from ba_chat.log_context import tool_calls_var

# Re-export so existing call sites that import APIError from this module keep
# working. TransientAPIError is exposed for callers that need to differentiate
# retryable failures.
__all__ = [
    "APIError",
    "TransientAPIError",
    "create_booking_direct",
    "create_booking_request",
    "get_recommendations",
    "range_check",
]

log = logging.getLogger(__name__)


async def _request(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    auth_header: str | None = None,
    settings: Settings | None = None,
) -> Any:
    settings = settings or get_settings()
    headers: dict[str, str] = {"Accept": "application/json"}
    token = auth_header or settings.api_token
    if token:
        headers["Authorization"] = (
            token if token.lower().startswith("bearer ") else f"Bearer {token}"
        )
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    timeout = httpx.Timeout(settings.request_timeout_seconds, connect=5.0)
    url = f"{settings.api_base_url}{path}"
    log.debug("%s %s params=%s body=%s", method, url, params, json_body)

    start_time = time.time()
    status = "SUCCESS"
    err_msg = ""
    res = {}

    try:
        async with async_client(timeout=timeout) as client:
            response = await client.request(
                method, url, params=params, json=json_body, headers=headers
            )
    except httpx.TimeoutException as exc:
        log.warning("%s %s timed out: %s", method, url, exc)
        status = "FAILED"
        err_msg = str(exc)
        raise TransientAPIError(
            504, f"upstream timed out after {settings.request_timeout_seconds:.0f}s"
        ) from exc
    except httpx.HTTPError as exc:
        log.warning("%s %s failed: %s", method, url, exc)
        status = "FAILED"
        err_msg = str(exc)
        raise TransientAPIError(502, f"upstream request failed: {exc}") from exc
    except Exception as exc:
        status = "FAILED"
        err_msg = str(exc)
        raise
    else:
        if response.status_code >= 500:
            raise TransientAPIError(response.status_code, response.text[:300])
        if response.status_code >= 300:
            raise APIError(response.status_code, response.text[:300])
        if response.content:
            res = response.json()
        return res
    finally:
        tool_calls = tool_calls_var.get()
        if tool_calls is not None:
            latency_ms = int((time.time() - start_time) * 1000)
            inputs = {}
            if params:
                inputs["params"] = params
            if json_body:
                inputs["body"] = json_body
            tool_calls.append({
                "tool_name": f"{method} {path}",
                "input_json": json.dumps(inputs),
                "output_json": json.dumps(res) if status == "SUCCESS" else "{}",
                "status": status,
                "latency_ms": latency_ms,
                "error_message": err_msg,
            })


# ---------------------------------------------------------------------------
# Recommendations + capacity
# ---------------------------------------------------------------------------


async def get_recommendations(
    *,
    start_date: str,
    end_date: str,
    capacity_percent: int,
    project_id: str | None = None,
    level: str | None = None,
    required_skill_ids: list[str] | None = None,
    limit: int = 5,
    auth_header: str | None = None,
) -> list[dict]:
    params: dict[str, Any] = {
        "start_date": start_date,
        "end_date": end_date,
        "capacity_percent": str(capacity_percent),
        "limit": str(limit),
    }
    if project_id:
        params["project_id"] = project_id
    if level:
        params["level"] = level
    if required_skill_ids:
        params["required_skill_ids"] = ",".join(required_skill_ids)
    return await _request("GET", "/api/ba/recommendations", params=params, auth_header=auth_header)


async def range_check(
    *,
    ba_id: str,
    start_date: str,
    end_date: str,
    capacity_percent: int,
    auth_header: str | None = None,
) -> dict:
    params = {
        "ba_id": ba_id,
        "start_date": start_date,
        "end_date": end_date,
        "capacity_percent": str(capacity_percent),
    }
    return await _request("GET", "/api/capacity/range-check", params=params, auth_header=auth_header)


# ---------------------------------------------------------------------------
# Write operations (gated by graph interrupt_before)
# ---------------------------------------------------------------------------


async def create_booking_request(
    slots: dict[str, Any], *, auth_header: str | None = None
) -> dict:
    """POST /api/bookings/request — PM_PO or BA_MANAGER."""
    return await _request("POST", "/api/bookings/request", json_body=slots, auth_header=auth_header)


async def create_booking_direct(
    slots: dict[str, Any], *, auth_header: str | None = None
) -> dict:
    """POST /api/bookings/direct — BA_MANAGER only, ba_id required."""
    return await _request("POST", "/api/bookings/direct", json_body=slots, auth_header=auth_header)
