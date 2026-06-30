"""Dependency-injection providers.

This is the composition root: it wires concrete repository implementations into
services, and resolves the current user from a bearer token. Routers depend on
these ``Annotated`` aliases, so swapping an implementation is a one-line change
here and nowhere else.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AuthError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.repositories.adventure_repository import AdventureRepository, SqlAdventureRepository
from app.repositories.user_repository import SqlUserRepository, UserRepository
from app.services.adventure_service import AdventureService
from app.services.auth_service import AuthService

DbSession = Annotated[Session, Depends(get_db)]

_bearer_scheme = HTTPBearer(auto_error=False)


# --- Repositories ---
def get_user_repository(db: DbSession) -> UserRepository:
    return SqlUserRepository(db)


def get_adventure_repository(db: DbSession) -> AdventureRepository:
    return SqlAdventureRepository(db)


# --- Services ---
def get_auth_service(
    users: Annotated[UserRepository, Depends(get_user_repository)],
) -> AuthService:
    return AuthService(users)


def get_adventure_service(
    adventures: Annotated[AdventureRepository, Depends(get_adventure_repository)],
) -> AdventureService:
    return AdventureService(adventures)


# --- Current user ---
def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> User:
    """Resolve and return the authenticated user, or raise ``AuthError``."""
    if credentials is None:
        raise AuthError("Not authenticated.")
    subject = decode_access_token(credentials.credentials)
    if subject is None:
        raise AuthError("Invalid or expired token.")
    user = db.get(User, int(subject))
    if user is None:
        raise AuthError("User no longer exists.")
    # Tag the request context so logs (and DB error rows) carry the user id.
    structlog.contextvars.bind_contextvars(user_id=user.id)
    return user


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
AdventureServiceDep = Annotated[AdventureService, Depends(get_adventure_service)]
CurrentUser = Annotated[User, Depends(get_current_user)]
