"""Shared fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from codevscode.db import engine
from codevscode.main import app


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session whose work is rolled back afterwards, even across commits.

    Skipped when there is no database, so the rest of the suite runs with Docker down.
    Failed instead when REQUIRE_DB=1, which CI sets: a job whose database never came up would
    otherwise go green having tested almost nothing.
    """
    try:
        connection = engine.connect()
        connection.execute(sql_text("SELECT 1"))
        # The probe autobegins a transaction; clear it before the explicit begin() below.
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


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
