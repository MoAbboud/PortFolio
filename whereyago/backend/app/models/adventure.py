"""Adventure model — a logged outing made up of ordered stops.

Each adventure has one weather snapshot, one stats row, and many stops, ratings,
likes and comments.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Vibe

if TYPE_CHECKING:
    from app.models.adventure_stats import AdventureStats
    from app.models.comment import Comment
    from app.models.like import Like
    from app.models.rating import Rating
    from app.models.stop import Stop
    from app.models.user import User
    from app.models.weather import Weather


class Adventure(Base):
    __tablename__ = "adventures"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(140))
    summary: Mapped[str | None] = mapped_column(Text, default=None)
    vibe: Mapped[Vibe] = mapped_column(Enum(Vibe, name="vibe"))
    city: Mapped[str | None] = mapped_column(String(140), default=None)
    date: Mapped[date_type | None] = mapped_column(Date, default=None)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped[User] = relationship(back_populates="adventures")
    stops: Mapped[list[Stop]] = relationship(
        back_populates="adventure",
        cascade="all, delete-orphan",
        order_by="Stop.position",
    )
    weather: Mapped[Weather | None] = relationship(
        back_populates="adventure", cascade="all, delete-orphan", uselist=False
    )
    stats: Mapped[AdventureStats | None] = relationship(
        back_populates="adventure", cascade="all, delete-orphan", uselist=False
    )
    ratings: Mapped[list[Rating]] = relationship(
        back_populates="adventure", cascade="all, delete-orphan"
    )
    likes: Mapped[list[Like]] = relationship(
        back_populates="adventure", cascade="all, delete-orphan"
    )
    comments: Mapped[list[Comment]] = relationship(
        back_populates="adventure", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Adventure id={self.id} title={self.title!r}>"
