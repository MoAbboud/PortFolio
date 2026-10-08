"""The pages and the JSON the map reads, through HTTP."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer.models import Listing
from tests.conftest import create_live, listing_data, verify_token_for

KC_BBOX = "-94.7,38.9,-94.4,39.2"


def form_fields(**overrides) -> dict[str, str]:
    fields = {
        "species": "dog",
        "name": "Formdog",
        "sex": "unknown",
        "size": "",
        "last_seen_local": "2026-10-01T18:30",
        "last_seen_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
        "last_seen_lat": "39.0329",
        "last_seen_lng": "-94.5936",
        "location_precision": "exact",
        "contact_phone": "(816) 555-0198",
        "show_phone": "on",
        "email": "form@example.com",
    }
    fields.update(overrides)
    return {k: v for k, v in fields.items() if v is not None}


def test_the_map_page_loads_leaflet_and_knows_where_to_open(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "leaflet.js" in response.text
    assert 'integrity="sha384-' in response.text
    assert 'data-lat="39.0997"' in response.text


def test_the_form_page_loads(client: TestClient) -> None:
    response = client.get("/listings/new")
    assert response.status_code == 200
    assert 'name="contact_phone"' in response.text


def post_form(client: TestClient, db_session: Session, **overrides) -> Listing:
    response = client.post("/listings", data=form_fields(**overrides), follow_redirects=False)
    assert response.status_code == 303
    code = response.headers["location"].split("code=")[1]
    return db_session.scalars(select(Listing).where(Listing.code == code)).one()


def test_posting_the_form_waits_for_the_email_link_then_goes_live(
    client: TestClient, db_session: Session
) -> None:
    response = client.post("/listings", data=form_fields(), follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"].startswith("/listings/sent?code=")

    sent = client.get(response.headers["location"])
    assert "Check your email" in sent.text
    assert "f***@example.com" in sent.text
    assert "form@example.com" not in sent.text

    listing = db_session.scalars(select(Listing).where(Listing.name == "Formdog")).one()
    # Not public, and not on the map, until verified.
    assert client.get(f"/l/{listing.code}").status_code == 404
    pins = client.get("/api/listings", params={"bbox": KC_BBOX}).json()
    assert listing.code not in {pin["code"] for pin in pins}

    token = verify_token_for(db_session, listing)
    published = client.post(f"/verify/{token}", follow_redirects=False)
    assert published.status_code == 303
    assert published.headers["location"] == f"/l/{listing.code}?posted=1"

    page = client.get(published.headers["location"])
    assert page.status_code == 200
    assert "Formdog" in page.text
    assert "Your listing is on the map" in page.text
    assert "Verified" in page.text


def test_an_unticked_phone_box_hides_the_number(client: TestClient, db_session: Session) -> None:
    listing = post_form(client, db_session, show_phone=None)
    client.post(f"/verify/{verify_token_for(db_session, listing)}")

    page = client.get(f"/l/{listing.code}")
    assert "555-0198" not in page.text
    assert "chosen not to show a phone number" in page.text


def test_a_bad_form_comes_back_with_the_problem_and_what_was_typed(
    client: TestClient, db_session: Session
) -> None:
    before = len(db_session.scalars(select(Listing)).all())

    response = client.post(
        "/listings", data=form_fields(contact_phone="12", last_seen_lat="", name="Keepme")
    )

    assert response.status_code == 400
    assert "needs at least 7 digits" in response.text
    assert "Drop a pin on the map" in response.text
    assert 'value="Keepme"' in response.text
    assert len(db_session.scalars(select(Listing)).all()) == before


def test_the_listing_page_never_shows_the_email(client: TestClient, db_session: Session) -> None:
    listing = create_live(db_session, listing_data(email="private@example.com"))
    page = client.get(f"/l/{listing.code}")
    assert page.status_code == 200
    assert "private@example.com" not in page.text
    assert "555-0199" in page.text


def test_listing_text_is_escaped(client: TestClient, db_session: Session) -> None:
    listing = create_live(
        db_session, listing_data(name="<script>alert(1)</script>")
    )
    page = client.get(f"/l/{listing.code}")
    assert "<script>alert(1)</script>" not in page.text
    assert "&lt;script&gt;" in page.text


def test_unknown_and_malformed_codes_are_404(client: TestClient) -> None:
    assert client.get("/l/zzzzzz").status_code == 404
    assert client.get("/l/not-a-code").status_code == 404


def test_a_hidden_listing_is_404_and_a_reunited_one_says_home(
    client: TestClient, db_session: Session
) -> None:
    hidden = create_live(db_session, listing_data())
    hidden.hidden_at = datetime.now(timezone.utc)
    hidden.hidden_reason = "test"
    home = create_live(db_session, listing_data(name="Homedog"))
    home.status = "reunited"
    db_session.commit()

    assert client.get(f"/l/{hidden.code}").status_code == 404
    page = client.get(f"/l/{home.code}")
    assert page.status_code == 200
    assert "Homedog is home" in page.text
    # Nobody needs to call about an animal that is home.
    assert "555-0199" not in page.text


def test_the_map_json_carries_no_email_and_no_phone(
    client: TestClient, db_session: Session
) -> None:
    listing = create_live(db_session, listing_data(email="private@example.com"))

    response = client.get("/api/listings", params={"bbox": KC_BBOX})

    assert response.status_code == 200
    pins = {pin["code"]: pin for pin in response.json()}
    assert listing.code in pins
    assert set(pins[listing.code]) == {
        "code", "species", "name", "lat", "lng", "approximate",
        "last_seen_at", "area_label", "verified", "thumb_url", "url",
    }
    assert pins[listing.code]["verified"] is True
    assert "private@example.com" not in response.text
    assert "555-0199" not in response.text


def test_a_bad_bbox_is_422(client: TestClient) -> None:
    assert client.get("/api/listings", params={"bbox": "nonsense"}).status_code == 422


def test_the_api_creates_a_listing_that_waits_for_verification(client: TestClient, db_session: Session) -> None:
    payload = listing_data(name="Apidog").model_dump(mode="json")

    response = client.post("/api/listings", json=payload)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending_verification"
    # Created, but not public until the owner uses the emailed link - same as the form.
    assert client.get(f"/l/{body['code']}").status_code == 404


def test_the_api_refuses_what_the_form_refuses(client: TestClient) -> None:
    payload = listing_data().model_dump(mode="json")
    payload["contact_phone"] = "12"
    assert client.post("/api/listings", json=payload).status_code == 422
