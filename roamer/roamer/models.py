"""The tables.

Stage 1: `owners`, `listings`, `listing_events`. The migration in
migrations/versions/0002_listings.py is hand-written and is the authority on constraints;
these classes are how the code reads and writes the rows.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from roamer.db import Base

# The vocabularies, in one place. The migration's CHECK constraints are built from these
# same tuples, so the database and the form cannot disagree about what a species is.
SPECIES = ("dog", "cat", "other")
SEXES = ("male", "female", "unknown")
SIZES = ("small", "medium", "large")
PRECISIONS = ("exact", "approximate")
SOURCES = ("owner", "import")

# Statuses a row can be stored in. `withdrawn` is not here although the status flow draws
# it: withdrawing deletes the listing, so no row is ever left in that state. `stale` and
# `hidden` are not here either - both are worked out from timestamps when read.
STATUSES = ("pending_verification", "awaiting_approval", "lost", "reunited")

# The one status that puts a listing on the public map. Hidden listings are excluded
# separately, by `hidden_at`.
ACTIVE_STATUS = "lost"

EVENT_KINDS = (
    "created",
    "verified",
    "approved",
    "edited",
    "photo_removed",
    "confirmed",
    "reunited",
    "reopened",
    "hidden",
    "unhidden",
    "claimed",
)
ACTORS = ("owner", "admin", "system")


class Owner(Base):
    __tablename__ = "owners"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    email_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    listings: Mapped[list[Listing]] = relationship(back_populates="owner")


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    code: Mapped[str] = mapped_column(Text, unique=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owners.id", ondelete="CASCADE")
    )
    source: Mapped[str] = mapped_column(Text, server_default="owner")
    status: Mapped[str] = mapped_column(Text)

    species: Mapped[str] = mapped_column(Text)
    name: Mapped[str | None] = mapped_column(Text)
    sex: Mapped[str] = mapped_column(Text, server_default="unknown")
    breed: Mapped[str | None] = mapped_column(Text)
    colours: Mapped[str | None] = mapped_column(Text)
    size: Mapped[str | None] = mapped_column(Text)
    age_text: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    approach_advice: Mapped[str | None] = mapped_column(Text)

    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_lat: Mapped[float] = mapped_column(Float)
    last_seen_lng: Mapped[float] = mapped_column(Float)
    location_precision: Mapped[str] = mapped_column(Text, server_default="exact")
    area_label: Mapped[str | None] = mapped_column(Text)

    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str] = mapped_column(Text)
    show_phone: Mapped[bool] = mapped_column(Boolean, server_default="true")

    last_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_reason: Mapped[str | None] = mapped_column(Text)
    seeded: Mapped[bool] = mapped_column(Boolean, server_default="false")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped[Owner | None] = relationship(back_populates="listings")
    events: Mapped[list[ListingEvent]] = relationship(
        back_populates="listing", order_by="ListingEvent.id", passive_deletes=True
    )


class ListingEvent(Base):
    """Append-only. Never updated."""

    __tablename__ = "listing_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text)
    detail: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    listing: Mapped[Listing] = relationship(back_populates="events")
