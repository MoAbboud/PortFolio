"""Database-backed logging."""

from __future__ import annotations

from app.core.db_logging import extract_error_frame, record_log_entry
from app.core.logging import get_logger
from app.models.log_entry import LogEntry
from sqlalchemy import select
from sqlalchemy.orm import Session


def test_record_log_entry_persists(db_session: Session) -> None:
    record_log_entry(
        {
            "level": "ERROR",
            "message": "boom",
            "error_type": "ValueError",
            "function": "do_thing",
            "line": 42,
            "user_id": 7,
        }
    )
    rows = db_session.scalars(select(LogEntry)).all()
    assert len(rows) == 1
    entry = rows[0]
    assert entry.level == "ERROR"
    assert entry.message == "boom"
    assert entry.function == "do_thing"
    assert entry.line == 42
    assert entry.user_id == 7
    assert entry.created_at is not None


def test_extract_error_frame_points_at_the_raise() -> None:
    def explode() -> None:
        raise ValueError("nope")

    filename = function = None
    line = None
    try:
        explode()
    except ValueError as exc:
        filename, function, line = extract_error_frame(exc.__traceback__)

    assert function == "explode"
    assert filename is not None and filename.endswith("test_logging.py")
    assert isinstance(line, int)


def test_warning_log_is_written_to_db(db_session: Session) -> None:
    get_logger("test").warning("disk_low", detail="ignored")
    rows = db_session.scalars(select(LogEntry)).all()
    assert len(rows) == 1
    assert rows[0].level == "WARNING"
    assert rows[0].message == "disk_low"


def test_oversized_string_fields_are_clipped(db_session: Session) -> None:
    record_log_entry({"level": "ERROR", "message": "x", "function": "f" * 500})
    entry = db_session.scalars(select(LogEntry)).one()
    assert entry.function is not None and len(entry.function) == 200
