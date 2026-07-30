"""Structured logging and safe request correlation helpers."""

from __future__ import annotations

import logging
import sys
import time
from collections.abc import Awaitable, Callable
from uuid import uuid4

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


def configure_logging(log_level: str) -> None:
    """Configure JSON logs without request bodies or sensitive values."""

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=log_level, force=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, log_level)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


class RequestIdLoggingMiddleware(BaseHTTPMiddleware):
    """Propagate a safe request id and log metadata-only request completion."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming_request_id = request.headers.get("X-Request-Id")
        request_id = incoming_request_id if incoming_request_id and len(incoming_request_id) <= 128 else str(uuid4())
        request.state.request_id = request_id
        logger = structlog.get_logger("helm.request")
        started_at = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "request_failed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
            )
            raise

        response.headers["X-Request-Id"] = request_id
        logger.info(
            "request_completed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        return response
