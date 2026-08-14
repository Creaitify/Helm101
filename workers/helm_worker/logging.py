"""Structured logging for HELM's agent worker."""

from __future__ import annotations

import logging
import sys

import structlog


def configure_logging(level: str = "WARNING", json_logs: bool = False) -> None:
    """Configure logging to stream to stderr so stdout remains clean for CLI reports."""
    logging.basicConfig(format="%(message)s", stream=sys.stderr, level=getattr(logging, level.upper(), logging.WARNING))
    
    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    if json_logs:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    structlog.configure(
        processors=processors,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.WARNING)),
        cache_logger_on_first_use=True,
    )

