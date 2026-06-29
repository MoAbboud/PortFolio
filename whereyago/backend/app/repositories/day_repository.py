"""Day repository: interface + SQLAlchemy implementation."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.day import Day


class DayRepository(Protocol):
    """Persistence operations the day service needs."""

    def get(self, day_id: int) -> Day | None: ...

    def add(self, day: Day) -> Day: ...

    def list_by_owner(self, owner_id: int) -> Sequence[Day]: ...

    def list_shared(self) -> Sequence[Day]: ...

    def delete(self, day: Day) -> None: ...


class SqlDayRepository:
    """SQLAlchemy-backed :class:`DayRepository`.

    Stops are eager-loaded with ``selectinload`` to avoid N+1 queries when
    serialising a day and its itinerary.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def get(self, day_id: int) -> Day | None:
        stmt = select(Day).where(Day.id == day_id).options(selectinload(Day.stops))
        return self._db.scalar(stmt)

    def add(self, day: Day) -> Day:
        self._db.add(day)
        self._db.flush()
        return day

    def list_by_owner(self, owner_id: int) -> Sequence[Day]:
        stmt = (
            select(Day)
            .where(Day.owner_id == owner_id)
            .options(selectinload(Day.stops))
            .order_by(Day.created_at.desc())
        )
        return self._db.scalars(stmt).all()

    def list_shared(self) -> Sequence[Day]:
        stmt = (
            select(Day)
            .where(Day.is_shared.is_(True))
            .options(selectinload(Day.stops))
            .order_by(Day.created_at.desc())
        )
        return self._db.scalars(stmt).all()

    def delete(self, day: Day) -> None:
        self._db.delete(day)
