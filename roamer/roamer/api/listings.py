"""JSON for the map, and the API twin of the listing form."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from roamer import geocode
from roamer import listings as service
from roamer.db import get_session
from roamer.schemas import ListingCreate, ListingCreated, ListingPin, NearPin, PlaceOut

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
        stale=service.is_stale(listing),
        last_confirmed_at=listing.last_confirmed_at,
        thumb_url=listing.animal_photos[0].thumb_url if listing.animal_photos else None,
        url=f"/l/{listing.code}",
    )


@router.get("/listings", response_model=list[ListingPin])
def listings_in_view(
    bbox: str = Query(description="west,south,east,north - Leaflet's toBBoxString()"),
    species: Literal["dog", "cat", "other"] | None = None,
    since_days: int | None = Query(default=None, ge=1, le=3650),
    include_stale: bool = False,
    session: Session = Depends(get_session),
) -> list[ListingPin]:
    """Active listings inside the map's view. Only what a pin and its popup need."""
    try:
        box = service.BBox.parse(bbox)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    found = service.active_in_bbox(
        session, box, species=species, since_days=since_days, include_stale=include_stale
    )
    return [to_pin(listing) for listing in found]


@router.get("/listings/near", response_model=list[NearPin])
def listings_near(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_km: float = Query(default=5, gt=0, le=service.MAX_NEAR_RADIUS_M / 1000),
    species: Literal["dog", "cat", "other"] | None = None,
    include_stale: bool = False,
    session: Session = Depends(get_session),
) -> list[NearPin]:
    """The finder's question: who near this point is missing an animal? Nearest first."""
    found = service.nearest(
        session, lat, lng, radius_km * 1000, species=species, include_stale=include_stale
    )
    return [
        NearPin(**to_pin(listing).model_dump(), distance_m=round(metres, 1))
        for listing, metres in found
    ]


def get_geocoder() -> geocode.Geocoder:
    return geocode.default_geocoder()


@router.get("/geocode", response_model=list[PlaceOut])
def geocode_search(
    q: str = Query(min_length=3, max_length=200),
    geocoder: geocode.Geocoder = Depends(get_geocoder),
) -> list[PlaceOut]:
    """Address to points, through the server's cache and rate limit. Called on submit only."""
    try:
        places = geocoder.search(q.strip())
    except geocode.GeocodeUnavailable as exc:
        raise HTTPException(
            status_code=503, detail="Address search is not available right now"
        ) from exc
    return [PlaceOut(label=p.label, lat=p.lat, lng=p.lng) for p in places]


@router.post("/listings", status_code=status.HTTP_201_CREATED, response_model=ListingCreated)
def create(data: ListingCreate, session: Session = Depends(get_session)) -> ListingCreated:
    listing = service.create_listing(session, data)
    return ListingCreated(
        code=listing.code,
        status=listing.status,
        message="Saved. It goes on the map when the link emailed to the owner is used.",
    )
