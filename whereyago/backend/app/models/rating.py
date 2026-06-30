"""Rating model — one 1-5 star rating per user per adventure."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.adventure import Adventure


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("adventure_id", "user_id", name="uq_rating_user_adventure"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    adventure_id: Mapped[int] = mapped_column(
        ForeignKey("adventures.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer)  # 1-5
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    adventure: Mapped[Adventure] = relationship(back_populates="ratings")
