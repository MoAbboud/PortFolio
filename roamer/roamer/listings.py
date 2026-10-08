"""The listing service. Routes call this; nothing else writes a listing.

A new listing waits at `pending_verification` until the link emailed to its owner is used.
Nothing anonymous reaches the map. The verify email is queued in the same transaction as the
listing, so a listing can never exist without its email on the way.

The verified badge is worked out when a listing is read, from timestamps, and never stored:
a stored flag would be right the day it was set and quietly wrong a month later, which is
the exact failure the badge exists to prevent.
"""

from __future__ import annotations

import enum
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from roamer import codes, images, mail, tokens
from roamer.config import settings
from roamer.models import ACTIVE_STATUS, EmailToken, Listing, ListingEvent, Owner, Photo
from roamer.schemas import ListingCreate

PENDING = "pending_verification"

# An approximate location is snapped to a grid on the way in, so the exact point the owner
# clicked is never stored - not shown, not returned by the API, not in a backup. 0.005
# degrees is about 550 m north-south and 430 m east-west at Kansas City's latitude. The
# page draws a circle of APPROXIMATE_RADIUS_M around the snapped point, which covers the
# cell the true point was in.
APPROXIMATE_GRID_DEG = 0.005
APPROXIMATE_RADIUS_M = 500

# How many times to draw a new code after a collision before giving up. At 887 million
# codes, needing a second try is unusual and needing a fifth means something else is wrong.
CODE_ATTEMPTS = 5

# The most pins one map request returns. The demo has a dozen; this is a ceiling against a
# zoomed-out request on a busy map, not a page size.
MAX_PINS = 500


class CodeExhausted(RuntimeError):
    """Every attempt at a unique code collided. Not expected to happen."""


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    @classmethod
    def parse(cls, text: str) -> BBox:
        """`west,south,east,north`, the order Leaflet's toBBoxString() produces."""
        parts = text.split(",")
        if len(parts) != 4:
            raise ValueError("bbox needs four numbers: west,south,east,north")
        west, south, east, north = (float(p) for p in parts)
        if not (-90 <= south <= north <= 90):
            raise ValueError("bbox latitudes must be within -90..90, south first")
        # Longitudes are clamped rather than refused: a zoomed-out Leaflet map reports
        # values past 180 when the world wraps, and that is a view, not an error.
        west = max(-180.0, min(180.0, west))
        east = max(-180.0, min(180.0, east))
        return cls(west, south, east, north)


def snap(value: float) -> float:
    return round(round(value / APPROXIMATE_GRID_DEG) * APPROXIMATE_GRID_DEG, 6)


def _owner_for(session: Session, email: str) -> Owner:
    # citext makes this match regardless of case, so Sam@ and sam@ are one owner.
    owner = session.scalars(select(Owner).where(Owner.email == email)).one_or_none()
    if owner is None:
        owner = Owner(email=email)
        session.add(owner)
        session.flush()
    return owner


def create_listing(
    session: Session,
    data: ListingCreate,
    *,
    seeded: bool = False,
    pre_verified: bool = False,
    photos: Sequence[images.ProcessedImage] = (),
    flyer: images.ProcessedImage | None = None,
    store: images.ImageStore | None = None,
    now: datetime | None = None,
) -> Listing:
    """Store a new listing, with its owner, photos, a `created` event and its verify email.

    `pre_verified` puts it straight on the map with no email. Only the demo's made-up
    listings use it - their addresses are at example.com and could never answer a link.

    Photos arrive already processed (see roamer.images). Their files are written before the
    commit; if the commit fails they are deleted again, so a failed post leaves no files.
    """
    now = now or datetime.now(timezone.utc)
    owner = _owner_for(session, str(data.email))
    if pre_verified and owner.email_confirmed_at is None:
        owner.email_confirmed_at = now

    lat, lng = data.last_seen_lat, data.last_seen_lng
    if data.location_precision == "approximate":
        lat, lng = snap(lat), snap(lng)

    fields = data.model_dump(exclude={"email", "last_seen_lat", "last_seen_lng"})
    for _ in range(CODE_ATTEMPTS):
        listing = Listing(
            **fields,
            code=codes.new_code(),
            owner_id=owner.id,
            source="owner",
            status=ACTIVE_STATUS if pre_verified else PENDING,
            last_seen_lat=lat,
            last_seen_lng=lng,
            # Set when the email link is used, and by every check-in answer after that.
            last_confirmed_at=now if pre_verified else None,
            seeded=seeded,
        )
        try:
            with session.begin_nested():
                session.add(listing)
                session.flush()
        except IntegrityError as exc:
            if getattr(exc.orig.diag, "constraint_name", None) == "listings_code_key":
                continue
            raise
        break
    else:
        raise CodeExhausted(f"no unique code after {CODE_ATTEMPTS} attempts")

    store = store or images.default_store()
    # Read now: after a rollback the object's attributes cannot be loaded any more.
    listing_id = listing.id
    try:
        _store_photos(session, store, listing, photos, flyer)
        session.add(
            ListingEvent(
                listing_id=listing.id,
                kind="created",
                actor="system" if seeded else "owner",
                detail={"seeded": True} if seeded else {},
            )
        )
        if not pre_verified:
            _queue_verify_email(session, listing, owner, now)
        session.commit()
    except Exception:
        session.rollback()
        store.delete_prefix(listing_prefix(listing_id))
        raise
    return listing


def listing_prefix(listing_id: uuid.UUID) -> str:
    return f"listings/{listing_id}/"


def _store_photos(
    session: Session,
    store: images.ImageStore,
    listing: Listing,
    photos: Sequence[images.ProcessedImage],
    flyer: images.ProcessedImage | None,
) -> None:
    if len(photos) > images.MAX_PHOTOS:
        raise ValueError(f"at most {images.MAX_PHOTOS} photos")
    items = [("photo", position, image) for position, image in enumerate(photos)]
    if flyer is not None:
        items.append(("flyer", 0, flyer))
    for kind, position, image in items:
        photo_id = uuid.uuid4()
        key = images.new_storage_key(listing.id, photo_id)
        store.put(f"{key}-display.jpg", image.display)
        store.put(f"{key}-thumb.jpg", image.thumb)
        session.add(
            Photo(
                id=photo_id,
                listing_id=listing.id,
                kind=kind,
                storage_key=key,
                width=image.width,
                height=image.height,
                position=position,
            )
        )


def delete_listings(
    session: Session, listing_ids: Sequence[uuid.UUID], store: images.ImageStore | None = None
) -> int:
    """Delete listings, their rows (by cascade) and their photo files. The caller commits.

    Every path that removes a listing goes through here, so no listing leaves files behind.
    Files go after the rows are gone from this transaction's point of view but before the
    commit; a failed commit leaves rows without files, which shows as a missing image, rather
    than files nobody can find, which shows as nothing at all.
    """
    if not listing_ids:
        return 0
    store = store or images.default_store()
    removed = session.execute(delete(Listing).where(Listing.id.in_(listing_ids))).rowcount
    for listing_id in listing_ids:
        store.delete_prefix(listing_prefix(listing_id))
    return removed


def _queue_verify_email(session: Session, listing: Listing, owner: Owner, now: datetime) -> None:
    token = tokens.issue(
        session,
        purpose="verify",
        owner_id=owner.id,
        listing_id=listing.id,
        lifetime=timedelta(hours=settings.verify_token_hours),
        now=now,
    )
    mail.queue(
        session,
        to=owner.email,
        template="verify",
        payload={
            "token": token,
            "code": listing.code,
            "name": listing.name,
            "species": listing.species,
            "hours": settings.verify_token_hours,
        },
    )


class Verify(enum.Enum):
    READY = "ready"  # a valid link for a listing still waiting
    PUBLISHED = "published"  # just published by this request
    ALREADY = "already"  # the listing is already live; the link was used before
    STALE = "stale"  # used or expired, and the listing is still waiting - offer a new link
    INVALID = "invalid"  # no such link, or its listing is gone


@dataclass
class VerifyResult:
    outcome: Verify
    listing: Listing | None = None
    token: EmailToken | None = None


def check_verify_link(session: Session, token: str, now: datetime | None = None) -> VerifyResult:
    """What the verify page should show for this link. Changes nothing.

    The GET of an email link must never act: mail providers' link scanners open every link
    before a person does, and a link that published on open would be published by a robot.
    """
    found = tokens.look_up(session, token, purpose="verify", now=now)
    listing = found.token.listing if found.token else None
    if listing is None:
        return VerifyResult(Verify.INVALID)
    if listing.status != PENDING:
        return VerifyResult(Verify.ALREADY, listing)
    if found.state is tokens.State.VALID:
        return VerifyResult(Verify.READY, listing, found.token)
    return VerifyResult(Verify.STALE, listing, found.token)


def publish(session: Session, token: str, now: datetime | None = None) -> VerifyResult:
    """Use a verify link: confirm the owner's address and put the listing on the map."""
    now = now or datetime.now(timezone.utc)
    result = check_verify_link(session, token, now)
    if result.outcome is not Verify.READY:
        return result

    listing = result.listing
    result.token.used_at = now
    if listing.owner.email_confirmed_at is None:
        listing.owner.email_confirmed_at = now
    # Stage 8 adds the approval switch here: with approval on, `awaiting_approval` instead.
    listing.status = ACTIVE_STATUS
    listing.last_confirmed_at = now
    session.add(ListingEvent(listing_id=listing.id, kind="verified", actor="owner"))
    session.commit()
    return VerifyResult(Verify.PUBLISHED, listing)


def resend_verify_link(session: Session, token: str, now: datetime | None = None) -> VerifyResult:
    """Send a fresh link for a listing still waiting, retiring the old ones.

    Reached from an old link, so only someone who received the first email can ask for a
    second, and it goes to the same address. Rate limits arrive with stage 8.
    """
    now = now or datetime.now(timezone.utc)
    result = check_verify_link(session, token, now)
    if result.outcome not in (Verify.READY, Verify.STALE):
        return result
    listing = result.listing
    tokens.supersede(session, purpose="verify", listing_id=listing.id, now=now)
    _queue_verify_email(session, listing, listing.owner, now)
    session.commit()
    return result


def delete_unverified(
    session: Session, now: datetime | None = None, store: images.ImageStore | None = None
) -> int:
    """Delete listings never verified within the retention period, and owners left with nothing.

    An address that never confirmed is not kept: somebody typed it, possibly not its owner.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=settings.unverified_retention_days)
    stale = session.scalars(
        select(Listing.id).where(Listing.status == PENDING, Listing.created_at < cutoff)
    ).all()
    removed = delete_listings(session, stale, store)
    session.execute(
        delete(Owner).where(
            Owner.email_confirmed_at.is_(None),
            ~exists().where(Listing.owner_id == Owner.id),
        )
    )
    session.commit()
    return removed


def is_verified(listing: Listing, now: datetime | None = None) -> bool:
    """The badge: an owner listing, a confirmed address, and a recent answer.

    It says the person managing the listing controls the email it was posted with and said
    recently that the animal is still missing. It does not say who owns the animal.
    """
    now = now or datetime.now(timezone.utc)
    window = timedelta(days=settings.checkin_interval_days + settings.checkin_grace_days)
    return (
        listing.source == "owner"
        and listing.owner is not None
        and listing.owner.email_confirmed_at is not None
        and listing.last_confirmed_at is not None
        and now - listing.last_confirmed_at <= window
    )


def mask_email(email: str) -> str:
    """s***@example.com - enough to recognise your own address, not enough to harvest one."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def get_by_code(session: Session, code: str) -> Listing | None:
    code = codes.normalise(code)
    if not codes.looks_valid(code):
        return None
    return session.scalars(select(Listing).where(Listing.code == code)).one_or_none()


def is_public(listing: Listing) -> bool:
    """Whether a listing's page may be shown to anyone who has the link.

    Live and reunited listings are public - "Biscuit is home" is the most useful thing a
    stale flyer can lead to. Hidden ones are not, and from stage 2 neither are listings still
    waiting for their email link.
    """
    return listing.hidden_at is None and listing.status in (ACTIVE_STATUS, "reunited")


def active_in_bbox(
    session: Session,
    bbox: BBox,
    *,
    species: str | None = None,
    since_days: int | None = None,
    now: datetime | None = None,
) -> list[Listing]:
    """Active listings inside the box, most recently seen first."""
    now = now or datetime.now(timezone.utc)

    if bbox.west <= bbox.east:
        in_lng = Listing.last_seen_lng.between(bbox.west, bbox.east)
    else:
        # A box across the 180th meridian, as Leaflet reports one over the Pacific.
        in_lng = or_(Listing.last_seen_lng >= bbox.west, Listing.last_seen_lng <= bbox.east)

    conditions = [
        Listing.status == ACTIVE_STATUS,
        Listing.hidden_at.is_(None),
        Listing.last_seen_lat.between(bbox.south, bbox.north),
        in_lng,
    ]
    if species:
        conditions.append(Listing.species == species)
    if since_days:
        conditions.append(Listing.last_seen_at >= now - timedelta(days=since_days))

    query = (
        select(Listing)
        # The badge reads the owner; load them in one query rather than one per pin.
        .options(selectinload(Listing.owner), selectinload(Listing.photos))
        .where(and_(*conditions))
        .order_by(Listing.last_seen_at.desc())
        .limit(MAX_PINS)
    )
    return list(session.scalars(query))
