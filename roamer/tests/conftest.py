"""Shared fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from roamer import images
from roamer import listings as service
from roamer.db import engine, get_session
from roamer.main import app
from roamer.models import Listing, OutboxMessage
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


@pytest.fixture(autouse=True)
def image_store(monkeypatch) -> images.MemoryImageStore:
    """Every image write and delete in every test goes here, never to disk.

    Autouse, because the service falls back to the real store when none is passed, and a test
    that reseeds or deletes listings would otherwise delete folders in the developer's own
    photo directory.
    """
    store = images.MemoryImageStore()
    monkeypatch.setattr(images, "default_store", lambda: store)
    return store


@pytest.fixture
def client(db_session: Session, image_store: images.MemoryImageStore) -> Iterator[TestClient]:
    """The app, reading and writing through the rolled-back test session."""
    from roamer.pages import get_image_store

    def override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_session] = override
    app.dependency_overrides[get_image_store] = lambda: image_store
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_image_store, None)


def create_live(session: Session, data: ListingCreate) -> Listing:
    """A listing already published - for tests about the map and the page, not about verifying."""
    return service.create_listing(session, data, pre_verified=True)


def verify_token_for(session: Session, listing: Listing) -> str:
    """The raw token in the newest verify email queued for this listing.

    Read from the outbox because that is the only place it exists: the database keeps its
    hash, and the email is the token's one copy.
    """
    rows = session.scalars(
        select(OutboxMessage)
        .where(OutboxMessage.template == "verify")
        .order_by(OutboxMessage.id.desc())
    ).all()
    for row in rows:
        if row.payload.get("code") == listing.code and "token" in row.payload:
            return row.payload["token"]
    raise AssertionError(f"no verify email queued for {listing.code}")
