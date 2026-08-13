"""FastAPI application factory for the HELM control-plane API."""

from __future__ import annotations

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.auth.errors import AuthError, auth_exception_handler
from app.auth.jwt_verifier import JwtVerifier
from app.config import Settings
from app.core.errors import http_exception_handler, problem_response, unhandled_exception_handler
from app.core.logging import RequestIdLoggingMiddleware, configure_logging
from app.db.session import create_database_engine, create_session_factory
from app.gateway.adapters.base import ProviderAdapter
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.errors import GatewayError
from app.gateway.ledger import InMemoryLedger
from app.gateway.service import GatewayService
from app.knowledge.analyst import AnalystService
from app.knowledge.sources import MarkdownFileSource


def _install_analyst(application: FastAPI, settings: Settings) -> None:
    """Build the gateway and Analyst once, at startup.

    Chooses the adapter by credential: the real provider when one is
    configured, recorded fixtures when it is not. That keeps every surface
    reachable on a machine with no credentials, which is what makes the
    Workspace demonstrable on a fresh clone.
    """

    keys = settings.gateway_keys()
    adapter: ProviderAdapter
    if keys.has("anthropic"):
        from app.gateway.adapters.anthropic import AnthropicAdapter

        adapter = AnthropicAdapter(keys)
        application.state.gateway_mode = "live"
    else:
        from app.gateway.contracts import TaskKind

        def _replay_responder(request: Any) -> RecordedCompletion:
            if request.task == TaskKind.MEDIA_BUYER_PROPOSAL:
                return RecordedCompletion(
                    text=(
                        '{"analysis": "Shift spend towards high-ROAS Retargeting and scale down non-brand search.", '
                        '"shifts": [{"campaign_id": "cmp_meta_retargeting_01", "proposed_budget": 125000, "reason": "High conversion velocity"}, '
                        '{"campaign_id": "cmp_google_search_nonbrand", "proposed_budget": 75000, "reason": "Shift funds to top performer"}]}'
                    )
                )
            if request.task == TaskKind.CREATIVE_VARIANTS:
                return RecordedCompletion(
                    text=(
                        '{"variants": [{"headline": "Complete Financial Health Checkup", "body": "Get a comprehensive portfolio review and unbiased financial roadmap today for ₹999."}, '
                        '{"headline": "Transparent Financial Assessment", "body": "Understand your wealth, investments, and tax profile with SEBI-registered advisors."}, '
                        '{"headline": "Take Control of Your Wealth", "body": "Clear, objective financial assessment designed to protect and grow your family assets."}]}'
                    )
                )
            if request.task == TaskKind.GOVERNOR_PLAN:
                return RecordedCompletion(
                    text=(
                        '{"plan_summary": "Coordinate multi-agent optimization for CAC reduction and creative refresh.", '
                        '"delegations": [{"agent": "media_buyer", "task": "lower blended CAC across active campaigns", "rationale": "Reallocate search budget to top-performing social channels"}, '
                        '{"agent": "creative", "task": "generate compliant copy for ₹999 checkup", "rationale": "Refresh copy variants for the new campaign push"}, '
                        '{"agent": "analyst", "task": "evaluate recent checkup funnel drop-offs", "rationale": "Identify conversion leaks in onboarding"}]}'
                    )
                )
            return RecordedCompletion(
                text=(
                    '{"answer": "No model provider is configured, so this is a recorded '
                    "reply rather than a generated one. Set ANTHROPIC_API_KEY to get real "
                    'answers.", "citations": []}'
                )
            )

        adapter = ReplayAdapter(responder=_replay_responder)
        application.state.gateway_mode = "replay"

    gateway = GatewayService(
        adapter=adapter,
        ledger=InMemoryLedger(default_cap_micros=settings.gateway_default_cap_micros),
        kill_switch=lambda: settings.gateway_kill_switch,
    )
    application.state.gateway = gateway
    application.state.analyst = AnalystService(
        gateway=gateway,
        source=MarkdownFileSource(settings.resolve_knowledge_root()),
    )


async def gateway_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render a gateway failure as RFC 9457 problem details.

    Each gateway error carries its own stable code, so the client can tell
    "you are out of budget" from "the model declined" from "the provider is
    down" — a distinction a generic 500 would erase.
    """

    error = exc if isinstance(exc, GatewayError) else GatewayError()
    return problem_response(
        request,
        status_code=error.status_code,
        title=error.code.replace("_", " ").title(),
        code=error.code,
        detail=error.detail,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API without initializing future infrastructure dependencies."""

    app_settings = settings or Settings()
    configure_logging(app_settings.log_level)
    application = FastAPI(title=app_settings.app_name, version=app_settings.app_version, docs_url=None, redoc_url=None)
    application.state.settings = app_settings
    application.add_middleware(RequestIdLoggingMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id", "X-HELM-Active-Tenant"],
        expose_headers=["X-Request-Id"],
    )
    if app_settings.database_url is not None:
        engine = create_database_engine(app_settings)
        application.state.session_factory = create_session_factory(engine)
    if app_settings.oidc_issuer is not None:
        application.state.jwt_verifier = JwtVerifier(app_settings.require_oidc(), httpx.AsyncClient(timeout=5.0))
    _install_analyst(application, app_settings)
    application.include_router(api_router)
    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(AuthError, auth_exception_handler)
    application.add_exception_handler(GatewayError, gateway_exception_handler)
    application.add_exception_handler(Exception, unhandled_exception_handler)

    @application.exception_handler(404)
    async def not_found(request: Request, _: Exception) -> JSONResponse:
        return problem_response(
            request,
            status_code=404,
            title="Not Found",
            code="resource_not_found",
            detail="The requested resource was not found.",
        )

    return application


app = create_app()
