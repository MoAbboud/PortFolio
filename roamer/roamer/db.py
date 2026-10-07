"""Database engine and session handling."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from roamer.config import settings

# The extensions the schema depends on, created by the first migration.
#
# cube and earthdistance answer "which listings are within 5 km of here, nearest first" with
# a GiST index, and they ship with PostgreSQL itself - unlike PostGIS, which the shared
# production database (pgvector's image) does not have. citext makes email addresses
# case-insensitive in the column rather than in every query that touches one.
REQUIRED_EXTENSIONS = ("citext", "cube", "earthdistance")


class Base(DeclarativeBase):
    """Declarative base for every table in the schema."""


# connect_timeout, because without it a database that is not there hangs rather than fails.
#
# Found at stage 0 on Windows with psycopg 3.3: a connection to a port nobody is listening on
# never returns. A plain socket is refused in two seconds; psycopg waits on the refused
# non-blocking connect indefinitely. The test suite with Docker down took six and a half
# minutes and then hung outright, when it should skip its database tests in a few seconds.
# With a timeout the same connection fails in exactly that long.
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
