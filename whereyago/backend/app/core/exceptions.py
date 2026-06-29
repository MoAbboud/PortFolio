"""Domain-level exceptions.

Services raise these transport-agnostic errors; a single FastAPI handler
(see ``app.main``) maps them to HTTP responses. This keeps the service layer
free of any web framework knowledge (Dependency Inversion).
"""

from __future__ import annotations


class AppError(Exception):
    """Base class for expected, handled application errors."""

    status_code: int = 400

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class AuthError(AppError):
    status_code = 401


class ForbiddenError(AppError):
    status_code = 403
