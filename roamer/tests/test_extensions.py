"""The extensions do what the finder's search will rely on.

Stage 4 builds the real query. These check the ground it stands on: that earth_distance
agrees with an independent great-circle calculation, that earth_box contains what is inside
the radius and not what is well outside it, and that citext compares email addresses without
regard to case.
"""

from __future__ import annotations

import math

from sqlalchemy import text
from sqlalchemy.orm import Session

# Two fixed points a known distance apart: Charing Cross and Notre-Dame.
LONDON = (51.5074, -0.1278)
PARIS = (48.8530, 2.3499)


def haversine_m(a: tuple[float, float], b: tuple[float, float], radius_m: float) -> float:
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * radius_m * math.asin(math.sqrt(h))


def test_earth_distance_matches_a_great_circle(db_session: Session) -> None:
    # earthdistance models the earth as a sphere of radius earth(). Using the same radius
    # here makes this a check of the extension, not of which radius is right.
    radius = db_session.execute(text("SELECT earth()")).scalar_one()
    measured = db_session.execute(
        text(
            "SELECT earth_distance(ll_to_earth(:lat1, :lng1), ll_to_earth(:lat2, :lng2))"
        ),
        {"lat1": LONDON[0], "lng1": LONDON[1], "lat2": PARIS[0], "lng2": PARIS[1]},
    ).scalar_one()

    expected = haversine_m(LONDON, PARIS, radius)

    assert abs(measured - expected) < 1.0
    # And it is the distance a person would recognise, roughly 340 km.
    assert 330_000 < measured < 350_000


def test_earth_box_holds_what_is_inside_the_radius(db_session: Session) -> None:
    # Points due north of London. 0.009 degrees of latitude is about 1 km.
    near = (LONDON[0] + 0.009, LONDON[1])
    far = (LONDON[0] + 0.045, LONDON[1])  # about 5 km

    def in_box(point: tuple[float, float], radius_m: float) -> bool:
        return db_session.execute(
            text(
                "SELECT earth_box(ll_to_earth(:clat, :clng), :r) @> ll_to_earth(:lat, :lng)"
            ),
            {"clat": LONDON[0], "clng": LONDON[1], "r": radius_m, "lat": point[0], "lng": point[1]},
        ).scalar_one()

    assert in_box(near, 2_000) is True
    assert in_box(far, 2_000) is False


def test_citext_compares_without_case(db_session: Session) -> None:
    same = db_session.execute(
        text("SELECT CAST(:a AS citext) = CAST(:b AS citext)"),
        {"a": "Sam@Example.com", "b": "sam@example.com"},
    ).scalar_one()

    assert same is True
