"""Day model — a logged itinerary made up of ordered stops."""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Vibe

if TYPE_CHECKING:
    from app.models.stop import Stop
    from app.models.user import User


class Day(Base):
    __tablename__ = "days"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(140))
    summary: Mapped[str | None] = mapped_column(Text, default=None)
    vibe: Mapped[Vibe] = mapped_column(Enum(Vibe, name="vibe"))
    city: Mapped[str | None] = mapped_column(String(140), default=None)
    date: Mapped[date_type | None] = mapped_column(Date, default=None)
    # Cached weather snapshot for the day, e.g. {"code": 1, "max": 74, "min": 58}.
    weather: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped[User] = relationship(back_populates="days")
    stops: Mapped[list[Stop]] = relationship(
        back_populates="day",
        cascade="all, delete-orphan",
        order_by="Stop.position",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Day id={self.id} title={self.title!r}>"
