"""/health: green only when the database answers at the newest migration."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from codevscode.api.health import migration_head
from codevscode.db import get_session
from codevscode.main import app


def use_session(session: object) -> None:
    def override() -> Iterator[object]:
        yield session

    app.dependency_overrides[get_session] = override


class _UnreachableSession:
    """Stands in for a session whose database has gone away."""

    def execute(self, *args: object, **kwargs: object) -> None:
        raise OperationalError(
            "SELECT version_num FROM alembic_version",
            {},
            Exception("connection to postgresql://codevscode:s3cret@db failed"),
        )


class _Result:
    def __init__(self, value: str) -> None:
        self._value = value

    def scalar(self) -> str:
        return self._value


class _SessionAt:
    """A database that answers, at a given migration."""

    def __init__(self, revision: str) -> None:
        self._revision = revision

    def execute(self, *args: object, **kwargs: object) -> _Result:
        return _Result(self._revision)


def test_healthy_with_a_migrated_database(client: TestClient, db_session: Session) -> None:
    use_session(db_session)

    response = client.get("/health")

    assert response.status_code == 200, response.json()
    assert response.json()["migrations"] == "ok"


def test_unreachable_database_is_503_and_names_only_the_error_class(client: TestClient) -> None:
    use_session(_UnreachableSession())

    response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["database"] == "unreachable"
    assert body["error"] == "OperationalError"
    # The connection string, and the password inside it, must not leak into the response.
    assert "s3cret" not in response.text


def test_a_database_behind_the_newest_migration_is_503_and_says_where_it_is(
    client: TestClient,
) -> None:
    use_session(_SessionAt("0000_older"))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["migrations"] == {"at": "0000_older", "head": migration_head()}


def test_the_head_is_read_from_the_migrations_folder() -> None:
    assert migration_head() == "0001_baseline"
