"""Shared fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from roamer.db import engine

# Imported for the side effect of registering the tables on Base.metadata.
from roamer import models  # noqa: F401


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session whose work is rolled back afterwards, even across commits.

    The session joins an outer transaction on a single connection and creates savepoints for
    its own commits, so code under test can commit normally and the database is still left
    exactly as it was found.

    Skipped when there is no database, so the rest of the suite runs on a machine with Docker
    down. Failed instead when REQUIRE_DB=1, which CI sets: a job whose database container
    never came up would otherwise go green having tested almost nothing.
    """
    try:
        connection = engine.connect()
        connection.execute(sql_text("SELECT 1"))
        # The probe autobegins a transaction. It has to be cleared, or the explicit begin()
        # below raises "this connection has already initialized a Transaction".
        connection.rollback()
    except SQLAlchemyError as exc:
        reason = f"no database available: {type(exc).__name__}"
        if os.environ.get("REQUIRE_DB") == "1":
            pytest.fail(f"REQUIRE_DB=1 and {reason}: {exc}")
        pytest.skip(reason)

    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
