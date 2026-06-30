"""LogEntry model — application logs persisted to the database.

Warnings/errors and unhandled exceptions are stored here (instead of log files)
so they can be queried directly. See ``app.core.db_logging`` for the writers.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LogEntry(Base):
    __tablename__ = "log_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    # "time and day" the entry was recorded.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    level: Mapped[str] = mapped_column(String(20), index=True)  # INFO / WARNING / ERROR
    logger: Mapped[str | None] = mapped_column(String(100), default=None)
    message: Mapped[str] = mapped_column(Text)

    # Error specifics.
    error_type: Mapped[str | None] = mapped_column(String(200), default=None)
    error_message: Mapped[str | None] = mapped_column(Text, default=None)
    module: Mapped[str | None] = mapped_column(Text, default=None)  # file / location
    function: Mapped[str | None] = mapped_column(String(200), default=None)
    line: Mapped[int | None] = mapped_column(Integer, default=None)
    traceback: Mapped[str | None] = mapped_column(Text, default=None)

    # Request context.
    user_id: Mapped[int | None] = mapped_column(Integer, index=True, default=None)
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    method: Mapped[str | None] = mapped_column(String(10), default=None)
    path: Mapped[str | None] = mapped_column(String(500), default=None)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<LogEntry id={self.id} level={self.level!r} {self.created_at:%Y-%m-%d %H:%M}>"
