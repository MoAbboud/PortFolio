"""The finder's search: nearest active listings, the index behind it, and address lookup."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from roamer import geocode
from roamer import listings as service
from roamer.api.listings import get_geocoder
from roamer.main import app
from tests.conftest import create_live, listing_data

# Loose Park, Kansas City, and points due north of it. 0.009 degrees of latitude is ~1 km.
LOOSE_PARK = (39.0329, -94.5936)


def north_of(km: float) -> dict:
    return {"last_seen_lat": LOOSE_PARK[0] + km * 0.009, "last_seen_lng": LOOSE_PARK[1]}


def haversine_m(a, b, radius_m: float) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * radius_m * math.asin(math.sqrt(h))


def test_nearest_first_with_true_distances(db_session: Session) -> None:
    far = create_live(db_session, listing_data(name="Far", **north_of(3)))
    near = create_live(db_session, listing_data(name="Near", **north_of(0.5)))

    found = service.nearest(db_session, *LOOSE_PARK, radius_m=5000)
    ours = [(listing.name, metres) for listing, metres in found if listing.id in (far.id, near.id)]

    assert [name for name, _ in ours] == ["Near", "Far"]
    earth = db_session.execute(text("SELECT earth()")).scalar_one()
    for listing, metres in found:
        if listing.id == near.id:
            expected = haversine_m(LOOSE_PARK, (near.last_seen_lat, near.last_seen_lng), earth)
            assert abs(metres - expected) < 1.0


def test_the_radius_is_a_circle_not_a_box(db_session: Session) -> None:
    # Diagonally out at 1.3 km on each axis: inside the earth_box for a 1.5 km radius (a
    # cube), but about 1.8 km away - outside the circle. earth_distance must trim it.
    corner = create_live(
        db_session,
        listing_data(
            last_seen_lat=LOOSE_PARK[0] + 1.3 * 0.009,
            last_seen_lng=LOOSE_PARK[1] + 1.3 * 0.0116,
        ),
    )
    found = service.nearest(db_session, *LOOSE_PARK, radius_m=1500)
    assert corner.id not in {listing.id for listing, _ in found}


def test_only_active_listings_and_the_right_species(db_session: Session) -> None:
    cat = create_live(db_session, listing_data(species="cat", **north_of(0.2)))
    hidden = create_live(db_session, listing_data(**north_of(0.2)))
    hidden.hidden_at = datetime.now(timezone.utc)
    hidden.hidden_reason = "test"
    home = create_live(db_session, listing_data(**north_of(0.2)))
    home.status = "reunited"
    pending = service.create_listing(db_session, listing_data(**north_of(0.2)))
    db_session.commit()

    ids = {listing.id for listing, _ in service.nearest(db_session, *LOOSE_PARK, radius_m=2000)}
    assert cat.id in ids
    assert not ids & {hidden.id, home.id, pending.id}

    dogs_only = service.nearest(db_session, *LOOSE_PARK, radius_m=2000, species="dog")
    assert cat.id not in {listing.id for listing, _ in dogs_only}


def test_the_query_can_use_the_distance_index(db_session: Session) -> None:
    # On a demo-sized table the planner rightly prefers a sequential scan, so it is taken off
    # the table for this transaction. The point is that the index matches the query at all.
    db_session.execute(text("SET LOCAL enable_seqscan = off"))
    plan = "\n".join(
        db_session.execute(
            text(
                "EXPLAIN SELECT id FROM listings "
                "WHERE status = 'lost' AND hidden_at IS NULL "
                "AND earth_box(ll_to_earth(39.03, -94.59), 5000) "
                "@> ll_to_earth(last_seen_lat, last_seen_lng)"
            )
        ).scalars()
    )
    assert "listings_active_earth" in plan


def test_the_near_api_returns_distances(client: TestClient, db_session: Session) -> None:
    listing = create_live(db_session, listing_data(**north_of(1)))

    response = client.get(
        "/api/listings/near", params={"lat": LOOSE_PARK[0], "lng": LOOSE_PARK[1], "radius_km": 2}
    )

    assert response.status_code == 200
    pin = next(p for p in response.json() if p["code"] == listing.code)
    assert 950 < pin["distance_m"] < 1050
    assert "email" not in pin and "contact_phone" not in pin


@pytest.mark.parametrize(
    "params",
    [
        {"lat": 91, "lng": 0},
        {"lat": 0, "lng": 0, "radius_km": 0},
        {"lat": 0, "lng": 0, "radius_km": 51},
        {"lng": 0},
    ],
)
def test_the_near_api_refuses_nonsense(client: TestClient, params: dict) -> None:
    assert client.get("/api/listings/near", params=params).status_code == 422


class FakeGeocoder:
    def __init__(self, places=None, fail=False) -> None:
        self.calls: list[str] = []
        self.places = places or []
        self.fail = fail

    def search(self, query: str):
        self.calls.append(query)
        if self.fail:
            raise geocode.GeocodeUnavailable("down")
        return self.places


@pytest.fixture
def fake_geocoder():
    fake = FakeGeocoder([geocode.Place("Loose Park, Kansas City", *LOOSE_PARK)])
    app.dependency_overrides[get_geocoder] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_geocoder, None)


def test_the_geocode_api_answers_from_the_geocoder(client: TestClient, fake_geocoder) -> None:
    response = client.get("/api/geocode", params={"q": "  loose park "})
    assert response.status_code == 200
    assert response.json() == [{"label": "Loose Park, Kansas City", "lat": 39.0329, "lng": -94.5936}]
    assert fake_geocoder.calls == ["loose park"]


def test_the_geocode_api_says_when_it_is_down(client: TestClient) -> None:
    app.dependency_overrides[get_geocoder] = lambda: FakeGeocoder(fail=True)
    try:
        assert client.get("/api/geocode", params={"q": "anywhere"}).status_code == 503
    finally:
        app.dependency_overrides.pop(get_geocoder, None)


def test_the_geocode_api_refuses_a_query_too_short(client: TestClient, fake_geocoder) -> None:
    assert client.get("/api/geocode", params={"q": "ab"}).status_code == 422
    assert fake_geocoder.calls == []


def test_repeated_searches_hit_the_cache() -> None:
    inner = FakeGeocoder([geocode.Place("Somewhere", 1.0, 2.0)])
    cached = geocode.CachedGeocoder(inner)

    cached.search("Loose Park")
    cached.search("  loose   PARK ")

    assert inner.calls == ["Loose Park"]


def test_failures_are_not_cached() -> None:
    inner = FakeGeocoder(fail=True)
    cached = geocode.CachedGeocoder(inner)
    for _ in range(2):
        with pytest.raises(geocode.GeocodeUnavailable):
            cached.search("x y z")
    assert len(inner.calls) == 2


def test_the_rate_limiter_spaces_calls_a_second_apart() -> None:
    now = [100.0]
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = geocode.RateLimiter(1.0, clock=lambda: now[0], sleep=sleep)
    limiter.wait()
    now[0] += 0.3
    limiter.wait()
    now[0] += 5
    limiter.wait()

    assert slept == [pytest.approx(0.7)]


def test_the_found_page_loads(client: TestClient) -> None:
    page = client.get("/found")
    assert page.status_code == 200
    assert "Use my location" in page.text
    assert "found.js" in page.text
