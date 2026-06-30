"""Weather model — one weather snapshot per adventure."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.adventure import Adventure


class Weather(Base):
    __tablename__ = "weather"

    id: Mapped[int] = mapped_column(primary_key=True)
    adventure_id: Mapped[int] = mapped_column(
        ForeignKey("adventures.id", ondelete="CASCADE"), unique=True, index=True
    )
    code: Mapped[int | None] = mapped_column(Integer, default=None)  # WMO weather code
    temp_max: Mapped[float | None] = mapped_column(Float, default=None)
    temp_min: Mapped[float | None] = mapped_column(Float, default=None)
    description: Mapped[str | None] = mapped_column(String(100), default=None)

    adventure: Mapped[Adventure] = relationship(back_populates="weather")
