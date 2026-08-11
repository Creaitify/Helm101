"""Tests for Stage 1 operational endpoints and cross-cutting HTTP behavior."""

from __future__ import annotations

import pytest
from app.config import HelmEnvironment, Settings
from app.main import create_app
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app() -> FastAPI:
    return create_app(Settings(helm_env=HelmEnvironment.TEST, app_name="HELM API Test", app_version="1.2.3"))


@pytest.mark.asyncio
async def test_health_is_alive_and_returns_request_id(app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/health", headers={"X-Request-Id": "test-request-123"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "HELM API Test"}
    assert response.headers["x-request-id"] == "test-request-123"


@pytest.mark.asyncio
async def test_ready_explicitly_marks_future_dependency_checks(app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "database": "not_configured_stage_1",
        "queue": "not_configured_stage_1",
    }
    assert response.headers["x-request-id"]


@pytest.mark.asyncio
async def test_version_exposes_only_safe_metadata(app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/version")

    assert response.status_code == 200
    assert response.json() == {"name": "HELM API Test", "version": "1.2.3", "environment": "test"}


@pytest.mark.asyncio
async def test_not_found_uses_problem_details_and_request_id(app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/missing")

    payload = response.json()
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert payload["status"] == 404
    assert payload["code"] == "resource_not_found"
    assert payload["request_id"] == response.headers["x-request-id"]


def test_production_rejects_wildcard_cors() -> None:
    with pytest.raises(ValueError, match="must not contain"):
        Settings(helm_env=HelmEnvironment.PRODUCTION, cors_origins=["*"])


def test_local_allows_empty_restrictive_cors_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """The default is restrictive: no origin is allowed unless one is configured.

    Constructs the absence rather than inheriting it. `Settings()` reads the
    ambient environment and `.env`, so this passed only on a machine where
    CORS_ORIGINS happened to be unset -- and failed the moment a real local
    `.env` set it. The assertion was right; its precondition was accidental.
    """

    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    settings = Settings(helm_env=HelmEnvironment.LOCAL, _env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origins == []
