"""What the form and the API accept. No database needed."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from tests.conftest import listing_data


def errors_for(**overrides) -> dict[str, str]:
    with pytest.raises(ValidationError) as caught:
        listing_data(**overrides)
    return {str(e["loc"][0]): e["msg"] for e in caught.value.errors()}


def test_a_minimal_listing_is_valid() -> None:
    data = listing_data()
    assert data.species == "dog"
    assert data.show_phone is True
    assert data.location_precision == "exact"


def test_blank_optional_fields_become_none() -> None:
    data = listing_data(name="   ", breed="", description="")
    assert data.name is None
    assert data.breed is None
    assert data.description is None


def test_last_seen_in_the_future_is_refused() -> None:
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    assert "last_seen_at" in errors_for(last_seen_at=tomorrow)


def test_a_few_minutes_of_clock_skew_is_allowed() -> None:
    listing_data(last_seen_at=datetime.now(timezone.utc) + timedelta(minutes=5))


def test_a_time_with_no_zone_is_refused_rather_than_guessed() -> None:
    assert "last_seen_at" in errors_for(last_seen_at=datetime(2026, 10, 1, 18, 30))


@pytest.mark.parametrize("phone", ["555", "call me", "816-555-01x9", ""])
def test_a_phone_number_has_to_be_dialable(phone: str) -> None:
    assert "contact_phone" in errors_for(contact_phone=phone)


@pytest.mark.parametrize("phone", ["(816) 555-0199", "+1 816 555 0199", "816.555.0199"])
def test_ordinary_phone_formats_are_accepted(phone: str) -> None:
    listing_data(contact_phone=phone)


def test_coordinates_off_the_planet_are_refused() -> None:
    assert "last_seen_lat" in errors_for(last_seen_lat=91)
    assert "last_seen_lng" in errors_for(last_seen_lng=-181)


def test_species_outside_the_list_is_refused() -> None:
    assert "species" in errors_for(species="dragon")


def test_email_has_to_be_an_address() -> None:
    assert "email" in errors_for(email="not-an-address")
