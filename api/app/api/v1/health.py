"""Stage 1 process health endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.config import HelmEnvironment

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    service: str
    # "live" when a provider key is configured, "replay" when canned fixtures
    # serve completions. Surfaced so an operator can tell at a glance whether
    # agents are really thinking or replaying recordings.
    gateway: str = "unknown"


class ReadinessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready"]
    database: Literal["not_configured_stage_1"]
    queue: Literal["not_configured_stage_1"]


class VersionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    version: str
    environment: HelmEnvironment


@router.get("/health", response_model=HealthResponse, summary="Process liveness")
async def health(request: Request) -> HealthResponse:
    """Confirm that the API process is serving requests."""

    return HealthResponse(
        status="ok",
        service=request.app.state.settings.app_name,
        gateway=str(getattr(request.app.state, "gateway_mode", "unknown")),
    )


@router.get("/ready", response_model=ReadinessResponse, summary="Stage 1 readiness")
async def readiness() -> ReadinessResponse:
    """Report minimal readiness; database and queue checks are future-stage work."""

    return ReadinessResponse(status="ready", database="not_configured_stage_1", queue="not_configured_stage_1")


@router.get("/version", response_model=VersionResponse, summary="Application version")
async def version(request: Request) -> VersionResponse:
    """Return safe release metadata only."""

    settings = request.app.state.settings
    return VersionResponse(name=settings.app_name, version=settings.app_version, environment=settings.helm_env)
