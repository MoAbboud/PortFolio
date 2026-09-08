"""/health, both ways.

The green path is the one everybody writes. The red path is the one that matters: a health
check that only proves the web server started is worth very little, and the stage 0 task
list requires this one to be verified to go red.

`database_status` is a FastAPI dependency precisely so that both paths can be exercised
here, with no container and no database.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from herder.core.db import database_status
from herder.main import create_app


@pytest.fixture
def app():
    return create_app()


def test_green_when_the_database_answers(app) -> None:
    async def ok() -> str:
        return "ok"

    app.dependency_overrides[database_status] = ok
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


def test_red_when_the_database_does_not(app) -> None:
    async def unreachable() -> str:
        return "unreachable"

    app.dependency_overrides[database_status] = unreachable
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unhealthy"
    assert body["database"] == "unreachable"


def test_health_reports_which_extractor_is_running(app) -> None:
    """Not a detail.

    The heuristic and the local model produce briefs of different quality. An operator who
    cannot see which one is running cannot interpret anything else the system reports.
    """

    async def ok() -> str:
        return "ok"

    app.dependency_overrides[database_status] = ok
    with TestClient(app) as client:
        body = client.get("/health").json()

    assert body["extractor"] in {"heuristic", "local", "trained"}


@pytest.mark.asyncio
async def test_database_status_says_unreachable_rather_than_raising() -> None:
    """With no database anywhere, the real probe returns a word instead of an exception."""
    assert await database_status() == "unreachable"
