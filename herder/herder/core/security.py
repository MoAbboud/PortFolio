"""herder's own API keys.

These are keys this system mints, for the browser extension, the MCP server and anything
calling the REST API. There is no provider key anywhere in this project.

Stored as a SHA-256 hash with a visible prefix. The key itself is shown once, at creation,
and is not recoverable afterwards - which is the point. SHA-256 rather than a password hash
because these are 256 bits of machine-generated randomness, not a human-chosen secret: there
is nothing to brute-force and nothing a slow hash would protect against.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.models import ApiKey

PREFIX = "hrd_"
_KEY_BYTES = 32


def generate_key() -> tuple[str, str, str]:
    """Return (plaintext, prefix, hash). The plaintext is never stored."""
    plaintext = PREFIX + secrets.token_urlsafe(_KEY_BYTES)
    return plaintext, plaintext[:16], hash_key(plaintext)


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.strip().encode("utf-8")).hexdigest()


def _presented(authorization: str | None, x_api_key: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    if x_api_key:
        return x_api_key.strip()
    return None


async def require_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ApiKey:
    """Authenticate a request. Accepts `Authorization: Bearer` or `X-API-Key`.

    PowerShell 5.1 sends headers awkwardly enough that having both is worth the few lines -
    every stage of this project has to be checkable from a terminal on Windows.
    """
    presented = _presented(authorization, x_api_key)
    if not presented:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="an API key is required, as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    digest = hash_key(presented)
    result = await session.execute(select(ApiKey).where(ApiKey.key_hash == digest))
    key = result.scalar_one_or_none()

    # compare_digest on the stored hash as well: the lookup above is already constant in
    # the useful sense, but this keeps the comparison explicit rather than implied.
    if key is None or not hmac.compare_digest(key.key_hash, digest):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unknown API key")
    if key.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="this API key has been revoked")

    await session.execute(update(ApiKey).where(ApiKey.id == key.id).values(last_used_at=func.now()))
    await session.commit()
    return key
