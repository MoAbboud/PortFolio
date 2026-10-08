"""JSON for the map, and the API twin of the listing form."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer.db import get_session
from roamer.schemas import ListingCreate, ListingCreated, ListingPin

router = APIRouter(prefix="/api", tags=["listings"])


def to_pin(listing) -> ListingPin:
    return ListingPin(
        code=listing.code,
        species=listing.species,
        name=listing.name,
        lat=listing.last_seen_lat,
        lng=listing.last_seen_lng,
        approximate=listing.location_precision == "approximate",
        last_seen_at=listing.last_seen_at,
        area_label=listing.area_label,
        verified=service.is_verified(listing),
        url=f"/l/{listing.code}",
    )


@router.get("/listings", response_model=list[ListingPin])
def listings_in_view(
    bbox: str = Query(description="west,south,east,north - Leaflet's toBBoxString()"),
    species: Literal["dog", "cat", "other"] | None = None,
    since_days: int | None = Query(default=None, ge=1, le=3650),
    session: Session = Depends(get_session),
) -> list[ListingPin]:
    """Active listings inside the map's view. Only what a pin and its popup need."""
    try:
        box = service.BBox.parse(bbox)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    found = service.active_in_bbox(session, box, species=species, since_days=since_days)
    return [to_pin(listing) for listing in found]


@router.post("/listings", status_code=status.HTTP_201_CREATED, response_model=ListingCreated)
def create(data: ListingCreate, session: Session = Depends(get_session)) -> ListingCreated:
    listing = service.create_listing(session, data)
    return ListingCreated(
        code=listing.code,
        status=listing.status,
        message="Saved. It goes on the map when the link emailed to the owner is used.",
    )
