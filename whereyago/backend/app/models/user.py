"""User model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.day import Day


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(100), default=None)
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    days: Mapped[list[Day]] = relationship(back_populates="owner", cascade="all, delete-orphan")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User id={self.id} username={self.username!r}>"
