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
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient backed by a fresh in-memory database per test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one shared connection -> data persists across requests
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

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
