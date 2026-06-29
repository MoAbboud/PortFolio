"""Structured logging setup (structlog).

One configuration drives the whole app: console-friendly output locally, JSON in
production. Per-request context (correlation id, path, method) is bound via
``contextvars`` in the middleware and automatically merged into every log line.

Golden rule enforced by convention: **never log secrets, passwords or tokens.**
Log identifiers (user_id, day_id) instead of payloads.
"""

from __future__ import annotations

import logging

import structlog

from app.core.config import get_settings


def configure_logging() -> None:
    """Configure structlog. Safe to call once at startup."""
    settings = get_settings()
    level = logging.getLevelNamesMapping().get(settings.LOG_LEVEL.upper(), logging.INFO)

    processors: list[structlog.typing.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if settings.LOG_JSON
        else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger."""
    logger: structlog.stdlib.BoundLogger = structlog.get_logger(name)
    return logger
