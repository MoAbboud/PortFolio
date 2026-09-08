"""Database engine, session factory, and the health probe.

The engine is created lazily and never connects at import time, so the package imports
cleanly with no database anywhere - which is what lets the stage 0 test suite run without
Docker.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from herder.core.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        # A connection that died while the pool was idle - a container restart, a laptop
        # sleeping - is discovered on checkout instead of in the middle of a derive.
        pool_pre_ping=True,
        future=True,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


async def database_status() -> str:
    """"ok" if the database answers a query, "unreachable" otherwise.

    This asks the database to actually do something rather than checking that a pool object
    exists. A health check that only proves the web server started is worth very little, and
    the stage 0 task list requires this one to be *verified to go red*.
    """
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
    except Exception:
        return "unreachable"
    return "ok"
