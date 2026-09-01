"""Database engine and session handling."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from mailman.config import settings


class Base(DeclarativeBase):
    """Declarative base for every table in the schema."""


engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding one session per request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
