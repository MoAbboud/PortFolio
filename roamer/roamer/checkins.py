"""Check-ins: asking owners, on a schedule, whether the animal is still missing.

The verified badge means "current", not just "real", and this is what keeps it honest. Every
CHECKIN_INTERVAL a silent owner gets one email with three answers - still missing, home, or
take it down. Any answer moves last_confirmed_at (or ends the listing). No answer and the
badge lapses after interval + grace; longer, and past STALE_AFTER the listing leaves the
default map and the emails stop.

Like every email link, the answers are GET-then-POST: opening a link shows a page with a
button, and only the button acts. A mail scanner opening "home" must not end a search.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session, selectinload

from roamer import images, listings, mail, tokens
from roamer.config import settings
from roamer.models import ACTIVE_STATUS, EmailToken, Listing, ListingEvent, Owner

ANSWERS = ("still_lost", "home", "remove")


def due_for_checkin(session: Session, now: datetime | None = None) -> list[Listing]:
    """Active listings whose owner has been silent for an interval and was not asked lately.

    Asked again each interval while silent - a reminder - until the listing goes stale, then
    no more: emailing a silent owner forever is spam. Seeded demo listings are never asked;
    their addresses are at example.com.
    """
    now = now or datetime.now(timezone.utc)
    interval = timedelta(days=settings.checkin_interval_days)
    stale = timedelta(days=settings.stale_after_days)
    asked_recently = exists().where(
        EmailToken.listing_id == Listing.id,
        EmailToken.purpose == "checkin",
        EmailToken.created_at > now - interval,
    )
    return list(
        session.scalars(
            select(Listing)
            .join(Owner, Owner.id == Listing.owner_id)
            .options(selectinload(Listing.owner))
            .where(
                and_(
                    Listing.status == ACTIVE_STATUS,
                    Listing.hidden_at.is_(None),
                    Listing.seeded.is_(False),
                    Owner.email_confirmed_at.is_not(None),
                    Listing.last_confirmed_at <= now - interval,
                    Listing.last_confirmed_at > now - stale,
                    ~asked_recently,
                )
            )
        )
    )


def send_checkins(session: Session, now: datetime | None = None) -> int:
    """Queue one check-in email per listing that is due. Returns how many."""
    now = now or datetime.now(timezone.utc)
    due = due_for_checkin(session, now)
    for listing in due:
        # A reminder replaces the last email's links: only the newest check-in works.
        tokens.supersede(session, purpose="checkin", listing_id=listing.id, now=now)
        token = tokens.issue(
            session,
            purpose="checkin",
            owner_id=listing.owner_id,
            listing_id=listing.id,
            lifetime=timedelta(days=settings.checkin_token_days),
            now=now,
        )
        days = (now - listing.last_confirmed_at).days
        mail.queue(
            session,
            to=listing.owner.email,
            template="checkin",
            payload={
                "token": token,
                "code": listing.code,
                "name": listing.name,
                "species": listing.species,
                "days": days,
            },
        )
    session.commit()
    return len(due)


class Outcome(enum.Enum):
    READY = "ready"  # a valid link: show the question
    CONFIRMED = "confirmed"  # still missing, recorded
    HOME = "home"  # marked home
    REMOVED = "removed"  # taken down
    USED = "used"  # this email was already answered, or replaced by a newer one
    EXPIRED = "expired"
    INVALID = "invalid"  # no such link, or the listing is gone


@dataclass
class CheckinResult:
    outcome: Outcome
    listing: Listing | None = None
    token: EmailToken | None = None


@dataclass
class Found:
    """Where, when and how the animal was found. Every part optional."""

    lat: float | None = None
    lng: float | None = None
    at: datetime | None = None
    how: str | None = None


def check(session: Session, token: str, now: datetime | None = None) -> CheckinResult:
    """What a check-in link's page should show. Changes nothing."""
    found = tokens.look_up(session, token, purpose="checkin", now=now)
    listing = found.token.listing if found.token else None
    if listing is None:
        return CheckinResult(Outcome.INVALID)
    if found.state is tokens.State.USED:
        return CheckinResult(Outcome.USED, listing, found.token)
    if found.state is tokens.State.EXPIRED:
        return CheckinResult(Outcome.EXPIRED, listing, found.token)
    if listing.status != ACTIVE_STATUS:
        # Home already, by some other route; nothing left to ask.
        return CheckinResult(Outcome.USED, listing, found.token)
    return CheckinResult(Outcome.READY, listing, found.token)


def answer(
    session: Session,
    token: str,
    choice: str,
    found: Found | None = None,
    *,
    store: images.ImageStore | None = None,
    now: datetime | None = None,
) -> CheckinResult:
    """Record the owner's answer. The token is used up whatever the answer."""
    if choice not in ANSWERS:
        raise ValueError(f"unknown answer {choice!r}")
    now = now or datetime.now(timezone.utc)
    result = check(session, token, now)
    if result.outcome is not Outcome.READY:
        return result

    listing = result.listing
    result.token.used_at = now

    if choice == "still_lost":
        listing.last_confirmed_at = now
        session.add(ListingEvent(listing_id=listing.id, kind="confirmed", actor="owner"))
        session.commit()
        return CheckinResult(Outcome.CONFIRMED, listing)

    if choice == "home":
        mark_home(session, listing, found or Found(), now=now)
        session.commit()
        return CheckinResult(Outcome.HOME, listing)

    listings.delete_listings(session, [listing.id], store)
    session.commit()
    return CheckinResult(Outcome.REMOVED)


def mark_home(session: Session, listing: Listing, found: Found, *, now: datetime) -> None:
    """The animal is home. Records where, when and how, if the owner said.

    The found point is the second half of the pair a future model needs. It is stored and
    never shown: it can be close to the owner's home. The caller commits.
    """
    if (found.lat is None) != (found.lng is None):
        raise ValueError("a found point needs both coordinates")
    listing.status = "reunited"
    listing.found_lat = found.lat
    listing.found_lng = found.lng
    listing.found_at = found.at or now
    listing.found_how = found.how
    session.add(
        ListingEvent(
            listing_id=listing.id,
            kind="reunited",
            actor="owner",
            detail={
                "found_point_given": found.lat is not None,
                "found_how": found.how,
            },
        )
    )
