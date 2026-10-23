"""The tables: the judge's queue (stage 2), and attempts with their questions (stage 3)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
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


ATTEMPT_MODES = ("practice", "ranked")


class Attempt(Base):
    """One player taking one challenge. Practice attempts need no account (`player_id` arrives
    with accounts at stage 7). The id is a random UUID, not a counter: without accounts, knowing
    an attempt's id is what lets someone ask questions on it, so it must not be guessable."""

    __tablename__ = "attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    challenge: Mapped[str] = mapped_column(Text, nullable=False)
    challenge_version: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(Text, nullable=False, server_default="practice")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint(f"mode IN {ATTEMPT_MODES}", name="attempts_mode"),)


class Question(Base):
    """Every question a player asks the client, revealed or not - for the score card, and to
    measure the matcher on real questions later. `requirement` is the best match whatever its
    score; `revealed` says whether it cleared the threshold."""

    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    attempt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    requirement: Mapped[str | None] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    revealed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    matcher: Mapped[str] = mapped_column(Text, nullable=False)
    asked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("questions_by_attempt", "attempt_id", "asked_at"),)
