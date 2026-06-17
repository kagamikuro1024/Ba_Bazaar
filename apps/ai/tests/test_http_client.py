from __future__ import annotations

import pytest

from ba_chat.http import async_client


async def test_async_client_ignores_missing_ssl_cert_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("SSL_CERT_FILE", str(tmp_path / "missing-ca.pem"))

    async with async_client() as client:
        assert client is not None


async def test_async_client_ignores_missing_ssl_cert_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("SSL_CERT_DIR", str(tmp_path / "missing-certs"))

    async with async_client() as client:
        assert client is not None
