"""User repository: interface + SQLAlchemy implementation."""

from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


class UserRepository(Protocol):
    """Persistence operations the auth service needs for users."""

    def get(self, user_id: int) -> User | None: ...

    def get_by_email(self, email: str) -> User | None: ...

    def get_by_username(self, username: str) -> User | None: ...

    def add(self, user: User) -> User: ...


class SqlUserRepository:
    """SQLAlchemy-backed :class:`UserRepository`."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get(self, user_id: int) -> User | None:
        return self._db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self._db.scalar(select(User).where(User.email == email))

    def get_by_username(self, username: str) -> User | None:
        return self._db.scalar(select(User).where(User.username == username))

    def add(self, user: User) -> User:
        self._db.add(user)
        self._db.flush()  # assign the generated id without committing
        return user
