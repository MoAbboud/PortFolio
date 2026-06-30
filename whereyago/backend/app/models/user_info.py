"""UserInfo model — a user's non-login profile details (one row per user)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class UserInfo(Base):
    __tablename__ = "user_info"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    address: Mapped[str | None] = mapped_column(String(300), default=None)
    phone: Mapped[str | None] = mapped_column(String(40), default=None)
    # A list of interest tags, e.g. ["hiking", "bbq", "live music"].
    interests: Mapped[list[str] | None] = mapped_column(JSON, default=None)

    user: Mapped[User] = relationship(back_populates="info")
