"""Search circles: the published figures, by species and outdoor access, and on the page."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from roamer import circles
from tests.conftest import create_live, listing_data


@pytest.mark.parametrize(
    ("access", "outer", "inner"),
    [
        # Huang et al. 2018: 75th percentile and median distance from the point of escape.
        ("indoor_only", 137, 39),
        ("indoor_outdoor", 1609, 300),
        ("outdoor", 1609, 300),
        ("unknown", 500, 50),
    ],
)
def test_cat_circles_are_the_published_figures(access: str, outer: int, inner: int) -> None:
    circle = circles.circle_for("cat", access)
    assert (circle.outer_m, circle.inner_m) == (outer, inner)
    assert circle.source is circles.HUANG_2018


@pytest.mark.parametrize("access", circles.OUTDOOR_ACCESS)
def test_dogs_get_one_circle_whatever_the_access(access: str) -> None:
    # Kremer 2021: 70% within 1 mile, 42% within 400 ft. No breakdown by access exists.
    circle = circles.circle_for("dog", access)
    assert (circle.outer_m, circle.outer_share, circle.inner_m, circle.inner_share) == (
        1609, "70%", 122, "42%",
    )
    assert circle.source is circles.KREMER_2021


def test_no_circle_for_animals_the_studies_do_not_cover() -> None:
    assert circles.circle_for("other", "unknown") is None


def test_every_source_has_a_doi_link() -> None:
    for source in (circles.HUANG_2018, circles.KREMER_2021):
        assert source.url.startswith("https://doi.org/10.")


def test_the_listing_page_draws_the_circle_and_names_the_study(
    client: TestClient, db_session: Session
) -> None:
    cat = create_live(db_session, listing_data(species="cat", outdoor_access="indoor_only"))

    page = client.get(f"/l/{cat.code}")

    assert 'data-search-outer="137"' in page.text
    assert 'data-search-inner="39"' in page.text
    assert "Huang et al. 2018" in page.text
    assert "not a prediction" in page.text


def test_no_circle_on_the_page_for_other_animals(client: TestClient, db_session: Session) -> None:
    rabbit = create_live(db_session, listing_data(species="other"))
    page = client.get(f"/l/{rabbit.code}")
    assert "data-search-outer" not in page.text
    assert "Where to search" not in page.text


def test_no_circle_once_the_animal_is_home(client: TestClient, db_session: Session) -> None:
    dog = create_live(db_session, listing_data(species="dog"))
    dog.status = "reunited"
    db_session.commit()
    page = client.get(f"/l/{dog.code}")
    assert "data-search-outer" not in page.text


def test_outdoor_access_is_stored(db_session: Session) -> None:
    cat = create_live(db_session, listing_data(species="cat", outdoor_access="indoor_outdoor"))
    assert cat.outdoor_access == "indoor_outdoor"
    assert create_live(db_session, listing_data()).outdoor_access == "unknown"
