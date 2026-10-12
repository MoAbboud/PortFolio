"""Database engine and session handling."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from codevscode.config import settings


class Base(DeclarativeBase):
    """Declarative base for every table in the schema. The first tables arrive at stage 2."""


# connect_timeout, because without it psycopg on Windows waits forever on a port nobody is
# listening on (found in roamer's stage 0), and a test run with Docker down hangs instead of
# skipping its database tests.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 5},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding one session per request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
