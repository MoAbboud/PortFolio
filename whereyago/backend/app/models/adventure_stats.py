"""AdventureStats model — cached engagement counters for an adventure.

Views, plus likes/comments counts kept in sync with the `adventure_likes` and
`comments` tables (which hold the actual records of who liked / what was said).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.adventure import Adventure


class AdventureStats(Base):
    __tablename__ = "adventure_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    adventure_id: Mapped[int] = mapped_column(
        ForeignKey("adventures.id", ondelete="CASCADE"), unique=True, index=True
    )
    views: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    likes_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    comments_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    adventure: Mapped[Adventure] = relationship(back_populates="stats")
