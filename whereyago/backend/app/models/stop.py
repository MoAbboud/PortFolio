"""Stop model — one place visited on a day."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import StopType

if TYPE_CHECKING:
    from app.models.day import Day


class Stop(Base):
    __tablename__ = "stops"

    id: Mapped[int] = mapped_column(primary_key=True)
    day_id: Mapped[int] = mapped_column(ForeignKey("days.id", ondelete="CASCADE"), index=True)
    # Zero-based order of the stop within its day.
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[StopType] = mapped_column(Enum(StopType, name="stop_type"))
    time: Mapped[str | None] = mapped_column(String(5), default=None)  # "HH:MM"
    note: Mapped[str | None] = mapped_column(Text, default=None)
    lat: Mapped[float | None] = mapped_column(Float, default=None)
    lon: Mapped[float | None] = mapped_column(Float, default=None)
    # Optional event details, e.g. {"title": "...", "doors": "7:00 PM", "price": "$45+"}.
    event: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)

    day: Mapped[Day] = relationship(back_populates="stops")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Stop id={self.id} name={self.name!r} position={self.position}>"
