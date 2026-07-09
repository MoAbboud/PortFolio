"""Typed exceptions for the GitHub tool layer.

Requirement: network errors and 4xx/5xx responses raise clear, typed
exceptions — we never swallow them. Callers (and, later, the agent loop) can
catch the specific type they care about instead of string-matching messages.
"""

from __future__ import annotations


class GitHubError(RuntimeError):
    """Base class for every error this package raises."""


class GitHubConnectionError(GitHubError):
    """A network-level failure (DNS, timeout, connection reset)."""


class GitHubAPIError(GitHubError):
    """The API returned a non-2xx response.

    Carries the HTTP status and the response body so the caller can log or act
    on the specifics.
    """

    def __init__(self, status_code: int, message: str, *, body: str = "") -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"GitHub API {status_code}: {message}")


class GitHubAuthError(GitHubAPIError):
    """401/403 — bad or missing token, or insufficient scopes."""


class GitHubNotFoundError(GitHubAPIError):
    """404 — repo or issue does not exist (or the token can't see it)."""


class GitHubRateLimitError(GitHubAPIError):
    """429, or 403 with the rate-limit signal — back off and retry later."""


class GitHubServerError(GitHubAPIError):
    """5xx — GitHub had a problem; usually safe to retry."""
