"""The workspace page and the files the browser loads: served, with the types a browser needs to
run them as modules, and nothing from a challenge's hidden half on the page."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codevscode.db import get_session
from codevscode.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_the_workspace_page_is_served_for_a_real_challenge_only(client: TestClient) -> None:
    page = client.get("/play/sample")
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    assert '<script type="module" src="/static/web/workspace.js">' in page.text
    assert client.get("/play/nope").status_code == 404
    assert client.get("/play/..%2F..%2Fetc").status_code == 404


def test_the_front_page_goes_to_the_sample(client: TestClient) -> None:
    response = client.get("/", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/play/sample"


@pytest.mark.parametrize(
    ("path", "kind"),
    [
        ("/static/web/workspace.js", "text/javascript"),
        ("/static/web/app-worker.js", "text/javascript"),
        ("/static/web/bridge.js", "text/javascript"),
        ("/static/runner/check.js", "text/javascript"),
        ("/static/runner/db.js", "text/javascript"),
        ("/static/helper/prompt.js", "text/javascript"),
        ("/static/web/vendor/sql-wasm-browser.js", "text/javascript"),
        ("/static/web/vendor/sql-wasm-browser.wasm", "application/wasm"),
        ("/static/web/workspace.css", "text/css"),
    ],
)
def test_browser_files_are_served_with_types_a_browser_will_run(client: TestClient, path: str, kind: str) -> None:
    response = client.get(path)
    assert response.status_code == 200, path
    assert response.headers["content-type"].startswith(kind), (path, response.headers["content-type"])


def test_hidden_files_are_not_served(client: TestClient) -> None:
    for path in ("/static/web/../challenges/sample/hidden/requirements.json", "/static/runner/../challenges/sample/hidden/bugs.json"):
        assert client.get(path).status_code == 404


def test_starting_an_attempt_gives_the_workspace_the_starter_and_the_walk_through(db_session: Session) -> None:
    def override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        with TestClient(app) as client:
            started = client.post("/attempts", json={"challenge": "sample"}).json()
            resumed = client.get(f"/attempts/{started['id']}").json()
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert sorted(started["files"]) == ["app.js", "index.html", "schema.sql"]
    assert "const ROUTES" in started["files"]["app.js"]
    assert [step["path"] for step in started["smoke"]["steps"]][:2] == ["/signup", "/login"]
    assert started["started_at"] and started["answers"] == []
    assert resumed == started
