"""The listing service. Routes call this; nothing else writes a listing.

Stage 1 has no verification, so a new listing goes straight on the map as `lost`. Stage 2
changes that one line: new listings start as `pending_verification` and wait for the email
link. Everything else here stays.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from roamer import codes
from roamer.models import ACTIVE_STATUS, Listing, ListingEvent, Owner
from roamer.schemas import ListingCreate

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
    now: datetime | None = None,
) -> Listing:
    """Store a new listing, with its owner and a `created` event, and commit."""
    now = now or datetime.now(timezone.utc)
    owner = _owner_for(session, str(data.email))

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
            status=ACTIVE_STATUS,
            last_seen_lat=lat,
            last_seen_lng=lng,
            # Stage 1 has no verification. From stage 2 this is set when the email link is
            # used, and by every check-in answer after that.
            last_confirmed_at=now,
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

    session.add(
        ListingEvent(
            listing_id=listing.id,
            kind="created",
            actor="system" if seeded else "owner",
            detail={"seeded": True} if seeded else {},
        )
    )
    session.commit()
    return listing


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
        .where(and_(*conditions))
        .order_by(Listing.last_seen_at.desc())
        .limit(MAX_PINS)
    )
    return list(session.scalars(query))
