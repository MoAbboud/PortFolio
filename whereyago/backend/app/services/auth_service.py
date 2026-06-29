"""Authentication & registration logic."""

from __future__ import annotations

from app.core.exceptions import AuthError, ConflictError
from app.core.logging import get_logger
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.user import UserCreate

logger = get_logger("service.auth")


class AuthService:
    """Registers users and verifies credentials.

    Depends on the ``UserRepository`` *interface*, so it is trivially unit-tested
    with an in-memory fake.
    """

    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def register(self, data: UserCreate) -> User:
        """Create a new user, rejecting duplicate email/username."""
        if self._users.get_by_email(data.email):
            raise ConflictError("That email is already registered.")
        if self._users.get_by_username(data.username):
            raise ConflictError("That username is already taken.")

        user = User(
            email=data.email,
            username=data.username,
            display_name=data.display_name,
            hashed_password=hash_password(data.password),
        )
        self._users.add(user)
        logger.info("user.registered", user_id=user.id, username=user.username)
        return user

    def authenticate(self, email: str, password: str) -> User:
        """Return the user if credentials are valid, else raise ``AuthError``."""
        user = self._users.get_by_email(email)
        # Verify even when the user is missing to keep timing roughly constant
        # and avoid leaking which emails exist.
        if user is None or not verify_password(password, user.hashed_password):
            logger.warning("auth.failed", email=email)
            raise AuthError("Incorrect email or password.")
        logger.info("auth.success", user_id=user.id)
        return user

    def issue_token(self, user: User) -> str:
        """Mint a signed access token for a user."""
        return create_access_token(subject=str(user.id))
