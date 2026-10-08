"""The listing service against a real database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import codes
from roamer import listings as service
from roamer.models import Listing, ListingEvent, Owner
from tests.conftest import create_live, listing_data

KC = service.BBox(west=-94.7, south=38.9, east=-94.4, north=39.2)


def test_create_stores_the_listing_its_owner_and_a_created_event(db_session: Session) -> None:
    listing = service.create_listing(db_session, listing_data(name="Biscuit"))

    stored = db_session.get(Listing, listing.id)
    assert stored.name == "Biscuit"
    # Not on the map until the emailed link is used.
    assert stored.status == "pending_verification"
    assert codes.looks_valid(stored.code)
    assert stored.owner.email == "owner@example.com"
    assert stored.owner.email_confirmed_at is None
    assert stored.last_confirmed_at is None

    events = db_session.scalars(
        select(ListingEvent).where(ListingEvent.listing_id == listing.id)
    ).all()
    assert [(e.kind, e.actor) for e in events] == [("created", "owner")]


def test_one_owner_per_address_whatever_the_case(db_session: Session) -> None:
    first = create_live(db_session, listing_data(email="Sam@Example.com"))
    second = create_live(db_session, listing_data(email="sam@example.com"))

    assert first.owner_id == second.owner_id
    owners = db_session.scalars(select(Owner).where(Owner.email == "SAM@example.com")).all()
    assert len(owners) == 1


def test_an_approximate_location_never_stores_the_exact_point(db_session: Session) -> None:
    exact_lat, exact_lng = 39.032912, -94.593645
    listing = create_live(
        db_session,
        listing_data(
            last_seen_lat=exact_lat,
            last_seen_lng=exact_lng,
            location_precision="approximate",
        ),
    )

    assert (listing.last_seen_lat, listing.last_seen_lng) != (exact_lat, exact_lng)
    # On the grid...
    for value in (listing.last_seen_lat, listing.last_seen_lng):
        steps = value / service.APPROXIMATE_GRID_DEG
        assert abs(steps - round(steps)) < 1e-6
    # ...and close enough that the circle drawn around it covers where it really was.
    assert abs(listing.last_seen_lat - exact_lat) <= service.APPROXIMATE_GRID_DEG / 2
    assert abs(listing.last_seen_lng - exact_lng) <= service.APPROXIMATE_GRID_DEG / 2


def test_an_exact_location_is_stored_as_given(db_session: Session) -> None:
    listing = create_live(
        db_session, listing_data(last_seen_lat=39.032912, last_seen_lng=-94.593645)
    )
    assert (listing.last_seen_lat, listing.last_seen_lng) == (39.032912, -94.593645)


def test_a_code_collision_draws_a_new_code(db_session: Session, monkeypatch) -> None:
    drawn = iter(["aaaaaa", "aaaaaa", "bbbbbb"])
    monkeypatch.setattr(codes, "new_code", lambda: next(drawn))

    first = create_live(db_session, listing_data())
    second = create_live(db_session, listing_data())

    assert first.code == "aaaaaa"
    assert second.code == "bbbbbb"


def test_endless_collisions_give_up_rather_than_loop(db_session: Session, monkeypatch) -> None:
    monkeypatch.setattr(codes, "new_code", lambda: "cccccc")
    create_live(db_session, listing_data())

    with pytest.raises(service.CodeExhausted):
        create_live(db_session, listing_data())


def test_get_by_code_forgives_capitals_and_refuses_junk(db_session: Session) -> None:
    listing = create_live(db_session, listing_data())

    assert service.get_by_code(db_session, listing.code.upper()).id == listing.id
    assert service.get_by_code(db_session, "not a code") is None


def codes_in(session: Session, box: service.BBox, **filters) -> set[str]:
    return {listing.code for listing in service.active_in_bbox(session, box, **filters)}


def test_the_map_shows_only_what_is_inside_the_view(db_session: Session) -> None:
    inside = create_live(db_session, listing_data())
    outside = create_live(
        db_session, listing_data(last_seen_lat=40.7128, last_seen_lng=-74.0060)
    )

    found = codes_in(db_session, KC)
    assert inside.code in found
    assert outside.code not in found


def test_species_and_how_recently_filter_the_map(db_session: Session) -> None:
    dog = create_live(db_session, listing_data(species="dog"))
    cat = create_live(db_session, listing_data(species="cat"))
    old = create_live(
        db_session,
        listing_data(last_seen_at=datetime.now(timezone.utc) - timedelta(days=40)),
    )

    assert cat.code not in codes_in(db_session, KC, species="dog")
    assert dog.code in codes_in(db_session, KC, species="dog")
    assert old.code not in codes_in(db_session, KC, since_days=30)
    assert old.code in codes_in(db_session, KC)


def test_hidden_and_reunited_listings_are_not_on_the_map(db_session: Session) -> None:
    hidden = create_live(db_session, listing_data())
    hidden.hidden_at = datetime.now(timezone.utc)
    hidden.hidden_reason = "test"
    home = create_live(db_session, listing_data())
    home.status = "reunited"
    db_session.commit()

    found = codes_in(db_session, KC)
    assert hidden.code not in found
    assert home.code not in found


def test_a_view_across_the_date_line_finds_both_sides(db_session: Session) -> None:
    east = create_live(
        db_session, listing_data(last_seen_lat=-17.7, last_seen_lng=178.0)
    )
    west = create_live(
        db_session, listing_data(last_seen_lat=-17.7, last_seen_lng=-179.0)
    )
    pacific = service.BBox(west=170.0, south=-20.0, east=-170.0, north=-15.0)

    found = codes_in(db_session, pacific)
    assert {east.code, west.code} <= found


@pytest.mark.parametrize("text", ["1,2,3", "a,b,c,d", "-94,39.2,-94.4,38.9"])
def test_a_malformed_bbox_is_refused(text: str) -> None:
    with pytest.raises(ValueError):
        service.BBox.parse(text)
