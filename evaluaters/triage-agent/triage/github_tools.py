"""The four GitHub tools for a single repo.

    list_open_issues() -> list of {id, title, body}      read-only
    get_issue(id)      -> {id, title, body, labels}       read-only
    add_label(id, label)                                  SIDE EFFECT
    post_comment(id, text)                                SIDE EFFECT

Design notes
------------
* "id" here means the issue **number** (per-repo, e.g. #42), NOT GitHub's
  global `id`. The number is what the write endpoints address, so using it as
  the single identifier keeps read and write tools consistent.
* All HTTP goes through one `_request()` method. That single choke point is
  where status codes become typed exceptions and where the tests inject a mock,
  so every tool inherits the same error handling for free.
* `owner/repo` and the token come from env vars — never hardcoded.
* Pull requests are excluded from `list_open_issues` (the REST issues endpoint
  returns PRs too; they carry a `pull_request` key).
"""

from __future__ import annotations

import os
from typing import Any, cast

import requests

from .errors import (
    GitHubAPIError,
    GitHubAuthError,
    GitHubConnectionError,
    GitHubNotFoundError,
    GitHubRateLimitError,
    GitHubServerError,
)

_API_ROOT = "https://api.github.com"
_TIMEOUT = 15  # seconds; a tool that hangs is worse than one that fails fast


class GitHubClient:
    """A thin, testable wrapper over the GitHub REST API for one repo."""

    def __init__(
        self,
        owner: str,
        repo: str,
        token: str,
        *,
        session: requests.Session | None = None,
        api_root: str = _API_ROOT,
    ) -> None:
        self.owner = owner
        self.repo = repo
        self.api_root = api_root.rstrip("/")
        # Injecting the session is what makes this unit-testable without network.
        self._session = session or requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )

    # -- the single HTTP choke point -------------------------------------------

    def _request(
        self, method: str, path: str, *, json: dict[str, Any] | None = None
    ) -> Any:
        url = f"{self.api_root}{path}"
        try:
            resp = self._session.request(
                method, url, json=json, timeout=_TIMEOUT
            )
        except requests.RequestException as exc:  # network-level failure
            raise GitHubConnectionError(f"{method} {path}: {exc}") from exc

        if resp.status_code >= 400:
            self._raise_for_status(resp)

        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    @staticmethod
    def _raise_for_status(resp: requests.Response) -> None:
        status = resp.status_code
        body = resp.text
        try:
            message = resp.json().get("message", resp.reason)
        except ValueError:
            message = resp.reason

        remaining = resp.headers.get("X-RateLimit-Remaining")
        if status == 429 or (status == 403 and remaining == "0"):
            raise GitHubRateLimitError(status, message, body=body)
        if status in (401, 403):
            raise GitHubAuthError(status, message, body=body)
        if status == 404:
            raise GitHubNotFoundError(status, message, body=body)
        if status >= 500:
            raise GitHubServerError(status, message, body=body)
        raise GitHubAPIError(status, message, body=body)

    # -- read-only tools -------------------------------------------------------

    def list_open_issues(self) -> list[dict[str, Any]]:
        """Return open issues as [{id, title, body}]. Read-only.

        Follows pagination and filters out pull requests.
        """
        issues: list[dict[str, Any]] = []
        path: str | None = (
            f"/repos/{self.owner}/{self.repo}/issues?state=open&per_page=100"
        )
        while path:
            url = f"{self.api_root}{path}"
            try:
                resp = self._session.request("GET", url, timeout=_TIMEOUT)
            except requests.RequestException as exc:
                raise GitHubConnectionError(f"GET {path}: {exc}") from exc
            if resp.status_code >= 400:
                self._raise_for_status(resp)

            for item in resp.json():
                if "pull_request" in item:
                    continue  # skip PRs; the issues endpoint includes them
                issues.append(
                    {
                        "id": item["number"],
                        "title": item["title"],
                        "body": item.get("body") or "",
                    }
                )
            path = _next_page_path(resp.headers.get("Link"), self.api_root)
        return issues

    def get_issue(self, issue_id: int) -> dict[str, Any]:
        """Return {id, title, body, labels} for one issue. Read-only."""
        data = self._request(
            "GET", f"/repos/{self.owner}/{self.repo}/issues/{issue_id}"
        )
        return {
            "id": data["number"],
            "title": data["title"],
            "body": data.get("body") or "",
            "labels": [lbl["name"] for lbl in data.get("labels", [])],
        }

    # -- mutating tools --------------------------------------------------------

    def add_label(self, issue_id: int, label: str) -> list[str]:
        """Add a label to an issue. **SIDE EFFECT** — mutates the repo.

        Returns the issue's full label list after the change.
        """
        data = self._request(
            "POST",
            f"/repos/{self.owner}/{self.repo}/issues/{issue_id}/labels",
            json={"labels": [label]},
        )
        return [lbl["name"] for lbl in cast("list[dict[str, Any]]", data or [])]

    def post_comment(self, issue_id: int, text: str) -> dict[str, Any]:
        """Post a comment on an issue. **SIDE EFFECT** — mutates the repo.

        Returns {comment_id, url} identifying the created comment.
        """
        data = self._request(
            "POST",
            f"/repos/{self.owner}/{self.repo}/issues/{issue_id}/comments",
            json={"body": text},
        )
        return {"comment_id": data["id"], "url": data["html_url"]}


def _next_page_path(link_header: str | None, api_root: str) -> str | None:
    """Extract the rel="next" path from a GitHub Link header, if present."""
    if not link_header:
        return None
    for part in link_header.split(","):
        segments = part.split(";")
        if len(segments) < 2:
            continue
        url = segments[0].strip().lstrip("<").rstrip(">")
        rel = segments[1].strip()
        if rel == 'rel="next"':
            return url[len(api_root):] if url.startswith(api_root) else url
    return None


# -- module-level convenience: build a default client from env vars -----------


def default_client() -> GitHubClient:
    """Construct a GitHubClient from GITHUB_REPO and GITHUB_TOKEN env vars."""
    repo_full = os.environ.get("GITHUB_REPO", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if "/" not in repo_full:
        raise ValueError("GITHUB_REPO must be set as 'owner/repo'")
    if not token:
        raise ValueError("GITHUB_TOKEN is not set")
    owner, repo = repo_full.split("/", 1)
    return GitHubClient(owner, repo, token)


# These four module-level functions are the "tools" the agent will call in
# Phase 2. Each is independently callable; each builds the default client from
# env. In tests we exercise GitHubClient directly with an injected session.


def list_open_issues() -> list[dict[str, Any]]:
    """Read-only. See GitHubClient.list_open_issues."""
    return default_client().list_open_issues()


def get_issue(issue_id: int) -> dict[str, Any]:
    """Read-only. See GitHubClient.get_issue."""
    return default_client().get_issue(issue_id)


def add_label(issue_id: int, label: str) -> list[str]:
    """**SIDE EFFECT.** See GitHubClient.add_label."""
    return default_client().add_label(issue_id, label)


def post_comment(issue_id: int, text: str) -> dict[str, Any]:
    """**SIDE EFFECT.** See GitHubClient.post_comment."""
    return default_client().post_comment(issue_id, text)
