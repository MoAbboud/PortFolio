"""/health: green only when the database answers and the extensions are installed."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from roamer.db import REQUIRED_EXTENSIONS, get_session
from roamer.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def use_session(session: object) -> None:
    def override() -> Iterator[object]:
        yield session

    app.dependency_overrides[get_session] = override


class _UnreachableSession:
    """Stands in for a session whose database has gone away."""

    def execute(self, *args: object, **kwargs: object) -> None:
        raise OperationalError(
            "SELECT 1",
            {},
            Exception("connection to postgresql://roamer:s3cret@db failed"),
        )


class _ResultWith:
    def __init__(self, names: list[str]) -> None:
        self._names = names

    def scalars(self) -> list[str]:
        return self._names


class _SessionWithExtensions:
    """A database that answers but has only some of the extensions."""

    def __init__(self, names: list[str]) -> None:
        self._names = names

    def execute(self, *args: object, **kwargs: object) -> _ResultWith:
        return _ResultWith(self._names)


def test_healthy_with_a_migrated_database(client: TestClient, db_session: Session) -> None:
    use_session(db_session)

    response = client.get("/health")

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["extensions"] == "ok"


def test_unreachable_database_is_503_and_names_only_the_error_class(client: TestClient) -> None:
    use_session(_UnreachableSession())

    response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["database"] == "unreachable"
    assert body["error"] == "OperationalError"
    # The connection string, and the password inside it, must not leak into the response.
    assert "s3cret" not in response.text


def test_missing_extension_is_503_and_names_it(client: TestClient) -> None:
    use_session(_SessionWithExtensions(["citext", "cube"]))

    response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["database"] == "ok"
    assert body["extensions"] == {"missing": ["earthdistance"]}


def test_every_required_extension_is_checked() -> None:
    # A guard on the list itself: the distance query needs all three, and dropping one from
    # REQUIRED_EXTENSIONS would make /health stop noticing it was missing.
    assert set(REQUIRED_EXTENSIONS) == {"citext", "cube", "earthdistance"}
