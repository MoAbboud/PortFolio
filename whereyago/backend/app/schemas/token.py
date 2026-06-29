"""Auth token schemas."""

from __future__ import annotations

from pydantic import BaseModel


class Token(BaseModel):
    """A bearer access token returned on login."""

    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """Decoded JWT payload."""

    sub: str | None = None
