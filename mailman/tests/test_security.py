"""The shared secret: what it guards, and what it deliberately does not.

The bug being pinned here is not a wrong check, it is a missing one. `mailman_api_key` sat in
the configuration for four stages behind a comment saying it was not enforced yet, and nothing
ever went red, because an unset secret and an unchecked secret are indistinguishable from
outside. So these tests assert the enforcement itself - that a write without the secret is
refused - rather than only that a correct secret works.

Most of them use a document id that does not exist. That separates the two things a response
could mean: 401 says the gate stopped the request, 404 says the gate let it through and the
route found nothing. A test that only asserted "not 200" would pass with the gate removed.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from mailman.api import security
from mailman.config import settings
from mailman.main import app

SECRET = "a-shared-secret-for-the-tests"
MISSING = uuid.uuid4()


@pytest.fixture()
def client():
    """The app with no database override.

    These tests never reach a database: every request is either refused at the gate or dies
    on a document that does not exist. That is the point - the gate has to run before the
    route, and a test that needed rows to prove it would be testing something else.
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def secret(monkeypatch: pytest.MonkeyPatch) -> str:
    """Turn enforcement on for one test.

    Set on `settings` rather than in the environment because `security` reads it at call
    time, which is itself deliberate: a value captured at import is a value a deployment can
    end up enforcing from before its environment was complete.
    """
    monkeypatch.setattr(settings, "mailman_api_key", SECRET)
    return SECRET


WRITE_ROUTES = [
    ("post", f"/documents/{MISSING}/approve"),
    ("post", f"/documents/{MISSING}/corrections"),
    ("post", f"/documents/{MISSING}/reprocess"),
    ("post", f"/review/{MISSING}"),
]


@pytest.mark.parametrize(("method", "path"), WRITE_ROUTES)
def test_a_write_without_the_secret_is_refused(
    client: TestClient, secret: str, method: str, path: str
) -> None:
    """Every route that changes something asks for the secret. Including the browser form:
    the review page is where approve and reject live, and leaving it open would have meant
    a public link where anyone can approve an invoice."""
    response = getattr(client, method)(path, json={})
    assert response.status_code == 401
    assert security.HEADER_NAME in response.json()["detail"]


@pytest.mark.parametrize(("method", "path"), WRITE_ROUTES)
def test_the_secret_gets_a_write_past_the_gate(
    client: TestClient, secret: str, method: str, path: str
) -> None:
    """404, not 401: the gate passed and the route ran. These ids do not exist, which is why
    the assertion can be this specific without touching a database."""
    response = getattr(client, method)(path, json={}, headers={security.HEADER_NAME: secret})
    assert response.status_code == 404


def test_the_wrong_secret_is_not_the_secret(client: TestClient, secret: str) -> None:
    response = client.post(
        f"/documents/{MISSING}/approve", headers={security.HEADER_NAME: "not-it"}
    )
    assert response.status_code == 401


def test_an_upload_without_the_secret_stores_nothing(client: TestClient, secret: str) -> None:
    """The endpoint the whole exercise is about. An open `POST /documents` on a public link
    is an open upload box, and this is the assertion that says it is closed."""
    response = client.post(
        "/documents", files={"file": ("x.pdf", b"%PDF-1.4 not really", "application/pdf")}
    )
    assert response.status_code == 401


def test_an_upload_with_the_secret_reaches_the_route(client: TestClient, secret: str) -> None:
    """400 for an empty file, not 401. The gate let it through and ingestion rejected it on
    its own terms - which also means nothing was stored by a test about authentication."""
    response = client.post(
        "/documents",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers={security.HEADER_NAME: SECRET},
    )
    assert response.status_code == 400


READ_ROUTES = ["/health", "/metrics", "/documents", "/"]


@pytest.mark.parametrize("path", READ_ROUTES)
def test_reads_stay_open_when_writes_are_locked(
    client: TestClient, secret: str, path: str, db_session
) -> None:
    """Reads are open on purpose, and that is the hosting decision rather than an oversight:
    a visitor can open the queue, read a document and read the numbers, and change nothing.
    It is the "read-only demo" the plan lists as one of its options, expressed as code."""
    from mailman.db import get_session

    app.dependency_overrides[get_session] = lambda: db_session
    try:
        assert client.get(path).status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_writes_are_open_when_no_secret_is_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unset means open, which is what a local run wants. The risk that buys is a deploy
    where somebody forgot the variable, and the answer to that is the next test rather than
    a check that fails closed and stops every developer's first upload."""
    monkeypatch.setattr(settings, "mailman_api_key", None)
    response = client.post(f"/documents/{MISSING}/approve")
    assert response.status_code == 404


def test_the_system_says_out_loud_whether_it_is_open(
    client: TestClient, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The fix for a silent failure is not a louder default, it is making the state visible.
    `Is this thing open?` has to be a question the system answers, because the reason nobody
    noticed for four stages is that the only way to find out was to try an upload."""
    from mailman.db import get_session

    app.dependency_overrides[get_session] = lambda: db_session
    try:
        monkeypatch.setattr(settings, "mailman_api_key", None)
        assert client.get("/health").json()["api_key"] == "not configured"
        assert client.get("/metrics").json()["security"]["api_key"] == "not configured"

        monkeypatch.setattr(settings, "mailman_api_key", SECRET)
        assert client.get("/health").json()["api_key"] == "enforced"
        assert client.get("/metrics").json()["security"]["api_key"] == "enforced"
    finally:
        app.dependency_overrides.clear()


def test_the_browser_unlocks_with_the_same_secret_the_api_uses(
    client: TestClient, secret: str
) -> None:
    """One secret, two envelopes. A form post cannot carry a header, so a header-only check
    would have made the review queue unusable the moment the secret was set - a worse bug
    than the open one it replaced."""
    assert client.post(f"/review/{MISSING}").status_code == 401

    unlocked = client.post("/unlock", data={"key": SECRET}, follow_redirects=False)
    assert unlocked.status_code == 303
    assert security.COOKIE_NAME in client.cookies

    # Same client, same cookie jar, and now the gate passes: 404 for a document that is not
    # there rather than 401 for a browser that is not allowed.
    assert client.post(f"/review/{MISSING}").status_code == 404


def test_the_wrong_secret_does_not_unlock_the_browser(client: TestClient, secret: str) -> None:
    """Rejected at the unlock rather than stored and failing later on whatever the reviewer
    tried next, which would have looked like the approve button being broken."""
    response = client.post("/unlock", data={"key": "not-it"}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/?unlocked=no"
    assert security.COOKIE_NAME not in client.cookies


def test_locking_forgets_the_secret(client: TestClient, secret: str) -> None:
    client.post("/unlock", data={"key": SECRET}, follow_redirects=False)
    client.post("/lock", follow_redirects=False)
    assert client.post(f"/review/{MISSING}").status_code == 401


def test_the_comparison_does_not_short_circuit_on_the_first_byte() -> None:
    """`compare_digest` rather than `==`. The secret here guards a portfolio demo rather than
    a bank, but a string comparison that returns early is a readable side channel and the
    constant-time version is one import."""
    import inspect

    source = inspect.getsource(security.key_matches)
    assert "compare_digest" in source

    assert security.key_matches(None) is True  # nothing configured, nothing to match
