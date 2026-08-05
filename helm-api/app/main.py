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
    application.include_router(api_router)
    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(AuthError, auth_exception_handler)
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
