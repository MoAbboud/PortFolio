"""The demo's made-up listings."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer import seed
from roamer.models import Listing
from tests.conftest import listing_data


def seeded(session: Session) -> list[Listing]:
    return list(session.scalars(select(Listing).where(Listing.seeded.is_(True))))


def test_reseeding_replaces_rather_than_duplicates(db_session: Session) -> None:
    seed.reseed(db_session)
    seed.reseed(db_session)

    assert len(seeded(db_session)) == len(seed.SEEDS) == 12


def test_every_seed_is_marked_as_made_up(db_session: Session) -> None:
    seed.reseed(db_session)

    for listing in seeded(db_session):
        assert seed.DEMO_NOTE in listing.description
        # 555-0100 to 555-0199 is the range reserved for fiction.
        assert "555-01" in listing.contact_phone
        assert listing.owner.email.endswith("@example.com")


def test_reseeding_never_touches_a_listing_a_person_posted(db_session: Session) -> None:
    mine = service.create_listing(db_session, listing_data(name="Realdog"))

    seed.reseed(db_session)

    assert db_session.get(Listing, mine.id) is not None


def test_the_seeds_include_old_and_approximate_listings(db_session: Session) -> None:
    # The filters and the approximate-area circle need something to show in the demo.
    seed.reseed(db_session)
    listings = seeded(db_session)

    assert any(listing.location_precision == "approximate" for listing in listings)
    assert {listing.species for listing in listings} == {"dog", "cat", "other"}
