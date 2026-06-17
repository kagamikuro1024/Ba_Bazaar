"""HTTP client helpers for the AI service."""

from __future__ import annotations

import logging
import os
import ssl
from pathlib import Path
from typing import Any

import certifi
import httpx

log = logging.getLogger(__name__)

_warned_bad_ca_paths: set[tuple[str, str]] = set()


def async_client(**kwargs: Any) -> httpx.AsyncClient:
    """Create an HTTPX async client that tolerates stale CA env paths.

    Some local shells export SSL_CERT_FILE or SSL_CERT_DIR from a removed
    virtualenv. HTTPX trusts those variables by default and crashes while
    building the SSL context, before callers can handle request errors. When
    either path is invalid, use certifi's bundled CA file while leaving the
    rest of HTTPX's environment handling, such as proxies, intact.
    """

    kwargs.setdefault("verify", _verify_setting())
    return httpx.AsyncClient(**kwargs)


def _verify_setting() -> bool | ssl.SSLContext:
    bad_paths = _bad_ca_env_paths()
    if not bad_paths:
        return True

    for name, value in bad_paths:
        key = (name, value)
        if key in _warned_bad_ca_paths:
            continue
        _warned_bad_ca_paths.add(key)
        log.warning("Ignoring %s=%s because the path does not exist", name, value)

    return ssl.create_default_context(cafile=certifi.where())


def _bad_ca_env_paths() -> list[tuple[str, str]]:
    bad_paths: list[tuple[str, str]] = []
    cert_file = os.getenv("SSL_CERT_FILE")
    if cert_file and not Path(cert_file).is_file():
        bad_paths.append(("SSL_CERT_FILE", cert_file))

    cert_dir = os.getenv("SSL_CERT_DIR")
    if cert_dir and not Path(cert_dir).is_dir():
        bad_paths.append(("SSL_CERT_DIR", cert_dir))

    return bad_paths
