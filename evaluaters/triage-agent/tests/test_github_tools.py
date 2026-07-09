"""Unit tests for the GitHub tool layer — the HTTP layer is fully mocked.

We inject a FakeSession into GitHubClient, so no network is ever touched. Each
test asserts either the request we sent (method, URL, JSON body) or the way a
response/error is translated into our typed return values and exceptions.
"""

from __future__ import annotations

import json as jsonlib
from typing import Any

import pytest
import requests

from triage.errors import (
    GitHubAuthError,
    GitHubConnectionError,
    GitHubNotFoundError,
    GitHubRateLimitError,
    GitHubServerError,
)
from triage.github_tools import GitHubClient


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        json_body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._json = json_body
        self.headers = headers or {}
        self.reason = "reason"
        self.text = "" if json_body is None else jsonlib.dumps(json_body)
        self.content = self.text.encode()

    def json(self) -> Any:
        if self._json is None:
            raise ValueError("no json")
        return self._json


class FakeSession:
    """Stands in for requests.Session. Returns queued responses, records calls."""

    def __init__(self, responses: list[FakeResponse] | Exception) -> None:
        self._responses = responses
        self.headers: dict[str, str] = {}
        self.calls: list[dict[str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        if isinstance(self._responses, Exception):
            raise self._responses
        return self._responses.pop(0)


def make_client(responses: list[FakeResponse] | Exception) -> tuple[GitHubClient, FakeSession]:
    session = FakeSession(responses)
    client = GitHubClient("acme", "widgets", "tok", session=session)  # type: ignore[arg-type]
    return client, session


def test_list_open_issues_filters_prs_and_maps_number_to_id() -> None:
    body = [
        {"number": 1, "title": "Bug", "body": "broken"},
        {"number": 2, "title": "PR", "body": "x", "pull_request": {"url": "..."}},
        {"number": 3, "title": "No body", "body": None},
    ]
    client, _ = make_client([FakeResponse(200, body)])
    issues = client.list_open_issues()
    assert issues == [
        {"id": 1, "title": "Bug", "body": "broken"},
        {"id": 3, "title": "No body", "body": ""},
    ]


def test_list_open_issues_follows_pagination() -> None:
    page1 = FakeResponse(
        200,
        [{"number": 1, "title": "one", "body": ""}],
        headers={"Link": '<https://api.github.com/x?page=2>; rel="next"'},
    )
    page2 = FakeResponse(200, [{"number": 2, "title": "two", "body": ""}])
    client, session = make_client([page1, page2])
    issues = client.list_open_issues()
    assert [i["id"] for i in issues] == [1, 2]
    assert len(session.calls) == 2  # it followed the next link


def test_get_issue_extracts_label_names() -> None:
    body = {
        "number": 7,
        "title": "T",
        "body": "B",
        "labels": [{"name": "bug"}, {"name": "high"}],
    }
    client, _ = make_client([FakeResponse(200, body)])
    assert client.get_issue(7) == {
        "id": 7,
        "title": "T",
        "body": "B",
        "labels": ["bug", "high"],
    }


def test_add_label_sends_correct_payload() -> None:
    client, session = make_client([FakeResponse(200, [{"name": "triage"}])])
    labels = client.add_label(42, "triage")
    assert labels == ["triage"]
    call = session.calls[0]
    assert call["method"] == "POST"
    assert call["url"].endswith("/repos/acme/widgets/issues/42/labels")
    assert call["json"] == {"labels": ["triage"]}


def test_post_comment_returns_identity() -> None:
    body = {"id": 999, "html_url": "https://github.com/acme/widgets/issues/1#c"}
    client, session = make_client([FakeResponse(201, body)])
    result = client.post_comment(1, "hello")
    assert result == {"comment_id": 999, "url": body["html_url"]}
    assert session.calls[0]["json"] == {"body": "hello"}


@pytest.mark.parametrize(
    ("status", "headers", "exc"),
    [
        (404, {}, GitHubNotFoundError),
        (401, {}, GitHubAuthError),
        (403, {"X-RateLimit-Remaining": "0"}, GitHubRateLimitError),
        (429, {}, GitHubRateLimitError),
        (500, {}, GitHubServerError),
        (503, {}, GitHubServerError),
    ],
)
def test_status_codes_map_to_typed_errors(status, headers, exc) -> None:
    resp = FakeResponse(status, {"message": "nope"}, headers=headers)
    client, _ = make_client([resp])
    with pytest.raises(exc) as info:
        client.get_issue(1)
    assert info.value.status_code == status  # type: ignore[attr-defined]


def test_network_failure_becomes_connection_error() -> None:
    client, _ = make_client(requests.ConnectionError("dns boom"))
    with pytest.raises(GitHubConnectionError):
        client.get_issue(1)


def test_errors_are_not_swallowed_on_mutating_tools() -> None:
    client, _ = make_client([FakeResponse(403, {"message": "no scope"})])
    with pytest.raises(GitHubAuthError):
        client.add_label(1, "x")
