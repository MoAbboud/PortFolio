"""The tables. One so far: the judge's queue (stage 2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from codevscode.db import Base

JOB_KINDS = ("judge", "house")
JOB_STATUSES = ("queued", "running", "done", "failed")


class Job(Base):
    """One run of a challenge's tests against one app, in the sandbox.

    `kind` is which tests: "judge" runs the hidden tests, "house" the house's findings.
    `payload` is what to run: `{"challenge": "<slug>", "files": {"app.js": "...", ...}}`. The
    files travel with the job; stage 5 moves them to a snapshots table and the job points at it.

    `status` moves queued -> running -> done, or back to queued when the worker running it
    fails (infrastructure, not the app's fault) or dies, until `max_attempts` - then failed.
    A job whose app loops forever or runs out of memory is done, not failed: that is a result,
    and running it again would give the same one.
    """

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="3")
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"kind IN {JOB_KINDS}", name="jobs_kind"),
        CheckConstraint(f"status IN {JOB_STATUSES}", name="jobs_status"),
        CheckConstraint("attempts >= 0 AND max_attempts >= 1", name="jobs_attempts"),
        # The worker claims the oldest queued job; the reaper scans running jobs by lock age.
        Index("jobs_queued", "id", postgresql_where=text("status = 'queued'")),
        Index("jobs_running", "locked_at", postgresql_where=text("status = 'running'")),
    )
