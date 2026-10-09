"""Check-ins and freshness, with the clock moved: verified, lapsed, stale, answered, verified."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import checkins, images, tokens
from roamer import listings as service
from roamer.config import settings
from roamer.models import Listing, ListingEvent, OutboxMessage
from tests.conftest import create_live, listing_data

KC_BBOX = service.BBox(west=-94.7, south=38.9, east=-94.4, north=39.2)
LOOSE_PARK = (39.0329, -94.5936)


def days(n: float) -> timedelta:
    return timedelta(days=n)


def live_confirmed_at(session: Session, when: datetime, **overrides) -> Listing:
    listing = create_live(session, listing_data(**overrides))
    listing.last_confirmed_at = when
    session.commit()
    return listing


def checkin_token_for(session: Session, listing: Listing) -> str:
    rows = session.scalars(
        select(OutboxMessage)
        .where(OutboxMessage.template == "checkin")
        .order_by(OutboxMessage.id.desc())
    ).all()
    for row in rows:
        if row.payload.get("code") == listing.code and "token" in row.payload:
            return row.payload["token"]
    raise AssertionError(f"no check-in queued for {listing.code}")


def due_codes(session: Session, now: datetime) -> set[str]:
    return {listing.code for listing in checkins.due_for_checkin(session, now)}


def on_map(session: Session, listing: Listing, now: datetime) -> bool:
    return listing.id in {l.id for l in service.active_in_bbox(session, KC_BBOX, now=now)}


def test_the_whole_life_of_a_quiet_listing(db_session: Session) -> None:
    start = datetime.now(timezone.utc)
    listing = live_confirmed_at(db_session, start, name="Quietdog")
    window = settings.checkin_interval_days + settings.checkin_grace_days

    # Day 1: verified, on the map, nobody asked yet.
    assert service.is_verified(listing, start + days(1))
    assert listing.code not in due_codes(db_session, start + days(1))

    # Day 8: an interval has passed - a check-in is queued, once.
    t8 = start + days(settings.checkin_interval_days + 1)
    assert checkins.send_checkins(db_session, t8) >= 1
    assert listing.code not in due_codes(db_session, t8 + timedelta(hours=1))

    # Day 11: still silent - the badge has lapsed, but it is still on the map.
    t11 = start + days(window + 1)
    assert not service.is_verified(listing, t11)
    assert not service.is_stale(listing, t11)
    assert on_map(db_session, listing, t11)

    # Day 15: another interval since the first email - asked again, and the first email's
    # links stop working: only the newest check-in counts.
    first = checkin_token_for(db_session, listing)
    t15 = t8 + days(settings.checkin_interval_days)
    checkins.send_checkins(db_session, t15)
    second = checkin_token_for(db_session, listing)
    assert second != first
    assert tokens.look_up(db_session, first, purpose="checkin").state is tokens.State.USED

    # Day 31: stale. Off the default map and the default search; on them with the filter.
    t31 = start + days(settings.stale_after_days + 1)
    assert service.is_stale(listing, t31)
    assert not on_map(db_session, listing, t31)
    with_stale = service.active_in_bbox(db_session, KC_BBOX, include_stale=True, now=t31)
    assert listing.id in {l.id for l in with_stale}
    near = service.nearest(db_session, *LOOSE_PARK, 5000, now=t31)
    assert listing.id not in {l.id for l, _ in near}
    # And nobody emails a stale listing's owner any more.
    assert listing.code not in due_codes(db_session, t31)

    # The owner finally answers "still missing": verified and on the map again.
    result = checkins.answer(db_session, second, "still_lost", now=t31)
    assert result.outcome is checkins.Outcome.CONFIRMED
    assert service.is_verified(listing, t31)
    assert on_map(db_session, listing, t31)


def test_never_asked(db_session: Session) -> None:
    now = datetime.now(timezone.utc)
    old = now - days(settings.checkin_interval_days + 1)

    seeded = live_confirmed_at(db_session, old)
    seeded.seeded = True
    hidden = live_confirmed_at(db_session, old)
    hidden.hidden_at, hidden.hidden_reason = now, "test"
    home = live_confirmed_at(db_session, old)
    home.status = "reunited"
    pending = service.create_listing(db_session, listing_data())
    fresh = live_confirmed_at(db_session, now - days(1))
    db_session.commit()

    due = due_codes(db_session, now)
    for listing in (seeded, hidden, home, pending, fresh):
        assert listing.code not in due


def test_the_email_has_three_links(db_session: Session) -> None:
    from roamer import mail

    now = datetime.now(timezone.utc)
    listing = live_confirmed_at(db_session, now - days(9), name="Linkdog",
                                email="links@example.com")
    checkins.send_checkins(db_session, now)
    recorder = mail.RecordingMailer()
    # A minute on: the outbox row's send-after time is the database's clock at insert, a
    # moment after `now` was read here. The real worker reads the clock afresh each cycle.
    mail.send_due(db_session, recorder, now + timedelta(minutes=1))

    message = next(m for m in recorder.sent if m["To"] == "links@example.com")
    assert message["Subject"] == "Is Linkdog still missing?"
    body = message.get_content()
    for answer in ("still_lost", "home", "remove"):
        assert f"?answer={answer}" in body
    assert "9 days" in body
    assert listing.code


def queued_listing(session: Session, **overrides) -> tuple[Listing, str]:
    now = datetime.now(timezone.utc)
    listing = live_confirmed_at(session, now - days(9), **overrides)
    checkins.send_checkins(session, now)
    return listing, checkin_token_for(session, listing)


def test_opening_a_check_in_link_changes_nothing(client: TestClient, db_session: Session) -> None:
    listing, token = queued_listing(db_session)
    before = listing.last_confirmed_at

    page = client.get(f"/checkin/{token}?answer=home")

    assert page.status_code == 200
    assert "is-chosen" in page.text  # the clicked choice is highlighted, nothing more
    db_session.refresh(listing)
    assert listing.status == "lost"
    assert listing.last_confirmed_at == before
    assert tokens.look_up(db_session, token, purpose="checkin").state is tokens.State.VALID


def test_still_missing_by_button(client: TestClient, db_session: Session) -> None:
    listing, token = queued_listing(db_session)

    response = client.post(f"/checkin/{token}", data={"answer": "still_lost"},
                           follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == f"/l/{listing.code}?confirmed=1"
    db_session.refresh(listing)
    assert service.is_verified(listing)
    again = client.get(f"/checkin/{token}")
    assert "Already answered" in again.text


def test_home_records_where_and_how_and_never_shows_it(
    client: TestClient, db_session: Session
) -> None:
    listing, token = queued_listing(db_session, name="Homedog")
    found_at = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()

    response = client.post(
        f"/checkin/{token}",
        data={"answer": "home", "found_how": "flyer", "found_lat": "39.041234",
              "found_lng": "-94.581234", "found_at": found_at},
        follow_redirects=False,
    )

    assert response.status_code == 303
    db_session.refresh(listing)
    assert listing.status == "reunited"
    assert (listing.found_lat, listing.found_lng, listing.found_how) == (39.041234, -94.581234, "flyer")
    assert abs((listing.found_at - datetime.fromisoformat(found_at)).total_seconds()) < 1
    events = [e.kind for e in db_session.scalars(
        select(ListingEvent).where(ListingEvent.listing_id == listing.id))]
    assert "reunited" in events

    page = client.get(f"/l/{listing.code}")
    assert "Homedog is home" in page.text
    for secret in ("39.041234", "-94.581234", "flyer"):
        assert secret not in page.text


def test_home_without_any_details_is_fine(client: TestClient, db_session: Session) -> None:
    listing, token = queued_listing(db_session)
    client.post(f"/checkin/{token}", data={"answer": "home"})
    db_session.refresh(listing)
    assert listing.status == "reunited"
    assert listing.found_lat is None and listing.found_how is None
    assert listing.found_at is not None  # when the owner said so


def test_a_half_point_or_a_made_up_answer_is_refused(
    client: TestClient, db_session: Session
) -> None:
    listing, token = queued_listing(db_session)

    half = client.post(f"/checkin/{token}", data={"answer": "home", "found_lat": "39.04"})
    assert half.status_code == 400
    assert "not on the map" in half.text

    made_up = client.post(f"/checkin/{token}", data={"answer": "home", "found_how": "magic"})
    assert made_up.status_code == 400

    nonsense = client.post(f"/checkin/{token}", data={"answer": "maybe"})
    assert nonsense.status_code == 400

    db_session.refresh(listing)
    assert listing.status == "lost"  # nothing was recorded by any of them


def test_take_it_down_deletes_the_listing_and_its_photos(
    client: TestClient, db_session: Session, image_store: images.MemoryImageStore
) -> None:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (20, 20)).save(out, format="PNG")
    now = datetime.now(timezone.utc)
    listing = service.create_listing(
        db_session, listing_data(), photos=[images.process(out.getvalue())],
        pre_verified=True, store=image_store,
    )
    listing.last_confirmed_at = now - days(9)
    db_session.commit()
    listing_id, code = listing.id, listing.code
    checkins.send_checkins(db_session, now)
    token = checkin_token_for(db_session, listing)

    response = client.post(f"/checkin/{token}", data={"answer": "remove"})

    assert response.status_code == 200
    assert "Taken down" in response.text
    assert db_session.get(Listing, listing_id) is None
    assert image_store.files == {}
    assert client.get(f"/l/{code}").status_code == 404


def test_an_unknown_link_is_404(client: TestClient) -> None:
    assert client.get("/checkin/nope").status_code == 404


def test_the_map_json_says_how_fresh_a_pin_is(client: TestClient, db_session: Session) -> None:
    listing = live_confirmed_at(db_session, datetime.now(timezone.utc) - days(12))
    pins = client.get("/api/listings", params={"bbox": "-94.7,38.9,-94.4,39.2"}).json()
    pin = next(p for p in pins if p["code"] == listing.code)
    assert pin["verified"] is False
    assert pin["stale"] is False
    assert pin["last_confirmed_at"]


@pytest.mark.parametrize("endpoint", ["listings", "listings/near"])
def test_stale_listings_need_the_filter(
    client: TestClient, db_session: Session, endpoint: str
) -> None:
    stale = live_confirmed_at(
        db_session, datetime.now(timezone.utc) - days(settings.stale_after_days + 2)
    )
    params = ({"bbox": "-94.7,38.9,-94.4,39.2"} if endpoint == "listings"
              else {"lat": LOOSE_PARK[0], "lng": LOOSE_PARK[1], "radius_km": 5})

    default = {p["code"] for p in client.get(f"/api/{endpoint}", params=params).json()}
    included = {p["code"] for p in client.get(
        f"/api/{endpoint}", params={**params, "include_stale": "true"}).json()}

    assert stale.code not in default
    assert stale.code in included


def test_a_stale_listing_page_says_so(client: TestClient, db_session: Session) -> None:
    stale = live_confirmed_at(
        db_session, datetime.now(timezone.utc) - days(settings.stale_after_days + 2)
    )
    page = client.get(f"/l/{stale.code}")
    assert page.status_code == 200
    assert "off the main map" in page.text
