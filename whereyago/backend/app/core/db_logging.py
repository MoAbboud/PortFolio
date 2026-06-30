"""Database-backed logging.

Persists warnings/errors (and full details of unhandled exceptions) to the
``log_entries`` table so they are queryable from the DB instead of scattered in
log files. Two entry points:

* :func:`record_log_entry` — writes one row in its **own** transaction, so an
  error is saved even when the failed request's transaction is rolled back. Used
  by the global exception handler.
* :func:`make_db_sink` — a structlog processor that persists ``WARNING``+ log
  calls (skipping exceptions, which the handler records with full detail).

Logging must never break the app, so every write is best-effort.
"""

from __future__ import annotations

import logging
import traceback as traceback_module
from collections.abc import Callable
from types import TracebackType
from typing import Any

import structlog
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.log_entry import LogEntry

SessionFactory = Callable[[], Session]

_fallback_logger = structlog.get_logger("db_logging")

# Swappable so tests can point DB-log writes at their throwaway database.
_session_factory: SessionFactory = SessionLocal

# Max lengths for the String() columns, so an oversized value can't break a write.
_MAX_LENGTHS = {
    "level": 20,
    "logger": 100,
    "error_type": 200,
    "function": 200,
    "correlation_id": 64,
    "method": 10,
    "path": 500,
}


def configure_log_session_factory(factory: SessionFactory) -> None:
    """Override the session factory used for DB-log writes (used in tests)."""
    global _session_factory
    _session_factory = factory


def _clip(fields: dict[str, Any]) -> dict[str, Any]:
    for key, limit in _MAX_LENGTHS.items():
        value = fields.get(key)
        if isinstance(value, str) and len(value) > limit:
            fields[key] = value[:limit]
    return fields


def record_log_entry(fields: dict[str, Any]) -> None:
    """Persist one log entry in an independent transaction. Never raises."""
    try:
        session = _session_factory()
        try:
            session.add(LogEntry(**_clip(dict(fields))))
            session.commit()
        finally:
            session.close()
    except Exception as exc:  # pragma: no cover - last-resort fallback to stdout
        _fallback_logger.error("db_log_write_failed", error=str(exc))


def extract_error_frame(
    tb: TracebackType | None,
) -> tuple[str | None, str | None, int | None]:
    """Return ``(file, function, line)`` of the deepest frame where the error arose."""
    frames = traceback_module.extract_tb(tb) if tb is not None else []
    if not frames:
        return None, None, None
    last = frames[-1]
    return last.filename, last.name, last.lineno


def make_db_sink(min_level_name: str) -> structlog.typing.Processor:
    """Build a structlog processor that writes ``WARNING``+ events to the DB.

    Events carrying ``exc_info`` (exceptions) are skipped here; the global
    exception handler records those with the full traceback and error location.
    """
    levels = logging.getLevelNamesMapping()
    threshold = levels.get(min_level_name.upper(), logging.WARNING)

    def db_sink(
        _logger: structlog.typing.WrappedLogger,
        method_name: str,
        event_dict: structlog.typing.EventDict,
    ) -> structlog.typing.EventDict:
        if event_dict.get("exc_info"):
            return event_dict
        if levels.get(method_name.upper(), logging.INFO) < threshold:
            return event_dict

        record_log_entry(
            {
                "level": method_name.upper(),
                "logger": event_dict.get("logger"),
                "message": str(event_dict.get("event", "")),
                "module": event_dict.get("filename"),
                "function": event_dict.get("func_name"),
                "line": event_dict.get("lineno"),
                "user_id": event_dict.get("user_id"),
                "correlation_id": event_dict.get("correlation_id"),
                "method": event_dict.get("method"),
                "path": event_dict.get("path"),
            }
        )
        return event_dict

    return db_sink
