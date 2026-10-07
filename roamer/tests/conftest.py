"""Shared fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from roamer.db import engine, get_session
from roamer.main import app
from roamer.schemas import ListingCreate

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


def listing_data(**overrides: Any) -> ListingCreate:
    """A valid listing, with any field replaced. Last seen an hour ago in Kansas City."""
    fields: dict[str, Any] = {
        "species": "dog",
        "name": "Testdog",
        "last_seen_at": datetime.now(timezone.utc) - timedelta(hours=1),
        "last_seen_lat": 39.0329,
        "last_seen_lng": -94.5936,
        "contact_phone": "(816) 555-0199",
        "email": "owner@example.com",
    }
    fields.update(overrides)
    return ListingCreate(**fields)


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """The app, reading and writing through the rolled-back test session."""

    def override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)
