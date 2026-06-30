"""Pytest fixtures.

The suite runs against a throwaway in-memory SQLite database with the DB
dependency overridden, so no Postgres/Docker is needed to run tests. Required
secrets are injected here *before* the app is imported so settings validation
passes.
"""

from __future__ import annotations

import os

os.environ.setdefault("SECRET_KEY", "test-secret-not-for-production-pad-to-32-bytes-minimum")
os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ.setdefault("LOG_JSON", "false")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from collections.abc import Iterator

import app.models
import pytest
from app.core.db_logging import configure_log_session_factory
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def _make_test_engine() -> Engine:
    """A fresh in-memory SQLite engine with the full schema created."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one shared connection -> data persists across sessions
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A direct DB session (for unit tests). Also routes DB-log writes here."""
    engine = _make_test_engine()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    configure_log_session_factory(factory)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient backed by a fresh in-memory database per test."""
    engine = _make_test_engine()
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    configure_log_session_factory(testing_session)  # DB logs -> test DB, not Postgres

    def override_get_db() -> Iterator[Session]:
        db = testing_session()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()
