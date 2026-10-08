"""Links sent by email: verify, and later manage and check-in.

A token is 32 random bytes, sent once inside a link, and stored only as its SHA-256. Anyone
holding a database dump holds hashes, which open nothing. Each token has a purpose, an expiry
and a used-at time; using one marks it used, and a used or expired token is refused.
"""

from __future__ import annotations

import enum
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from roamer.models import EmailToken


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def issue(
    session: Session,
    *,
    purpose: str,
    owner_id,
    listing_id=None,
    lifetime: timedelta,
    now: datetime | None = None,
) -> str:
    """Create a token and return it. The caller puts it in an email; it is not kept."""
    now = now or datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    session.add(
        EmailToken(
            token_hash=hash_token(token),
            purpose=purpose,
            owner_id=owner_id,
            listing_id=listing_id,
            expires_at=now + lifetime,
        )
    )
    return token


def supersede(session: Session, *, purpose: str, listing_id, now: datetime | None = None) -> None:
    """Mark every unused token of this purpose for this listing as used.

    So that sending a new link retires the old ones, and only the newest link works.
    """
    now = now or datetime.now(timezone.utc)
    session.execute(
        update(EmailToken)
        .where(
            EmailToken.purpose == purpose,
            EmailToken.listing_id == listing_id,
            EmailToken.used_at.is_(None),
        )
        .values(used_at=now)
    )


class State(enum.Enum):
    VALID = "valid"
    USED = "used"
    EXPIRED = "expired"
    UNKNOWN = "unknown"


@dataclass
class Lookup:
    state: State
    token: EmailToken | None


def look_up(
    session: Session, token: str, *, purpose: str, now: datetime | None = None
) -> Lookup:
    """Find a token by its hash and say whether it can still be used. Changes nothing."""
    now = now or datetime.now(timezone.utc)
    found = session.scalars(
        select(EmailToken).where(
            EmailToken.token_hash == hash_token(token), EmailToken.purpose == purpose
        )
    ).one_or_none()
    if found is None:
        return Lookup(State.UNKNOWN, None)
    if found.used_at is not None:
        return Lookup(State.USED, found)
    if found.expires_at <= now:
        return Lookup(State.EXPIRED, found)
    return Lookup(State.VALID, found)
