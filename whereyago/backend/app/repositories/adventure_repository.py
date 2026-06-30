"""Adventure repository: interface + SQLAlchemy implementation."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.models.adventure import Adventure


class AdventureRepository(Protocol):
    """Persistence operations the adventure service needs."""

    def get(self, adventure_id: int) -> Adventure | None: ...

    def add(self, adventure: Adventure) -> Adventure: ...

    def list_by_owner(self, owner_id: int) -> Sequence[Adventure]: ...

    def list_shared(self) -> Sequence[Adventure]: ...

    def delete(self, adventure: Adventure) -> None: ...


class SqlAdventureRepository:
    """SQLAlchemy-backed :class:`AdventureRepository`.

    Eager-loads stops, weather and stats to avoid N+1 queries when serialising.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def _loaded(self, stmt: Select[tuple[Adventure]]) -> Select[tuple[Adventure]]:
        return stmt.options(
            selectinload(Adventure.stops),
            selectinload(Adventure.weather),
            selectinload(Adventure.stats),
        )

    def get(self, adventure_id: int) -> Adventure | None:
        return self._db.scalar(self._loaded(select(Adventure).where(Adventure.id == adventure_id)))

    def add(self, adventure: Adventure) -> Adventure:
        self._db.add(adventure)
        self._db.flush()
        return adventure

    def list_by_owner(self, owner_id: int) -> Sequence[Adventure]:
        stmt = self._loaded(select(Adventure).where(Adventure.owner_id == owner_id)).order_by(
            Adventure.created_at.desc()
        )
        return self._db.scalars(stmt).all()

    def list_shared(self) -> Sequence[Adventure]:
        stmt = self._loaded(select(Adventure).where(Adventure.is_shared.is_(True))).order_by(
            Adventure.created_at.desc()
        )
        return self._db.scalars(stmt).all()

    def delete(self, adventure: Adventure) -> None:
        self._db.delete(adventure)
