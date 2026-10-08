"""The verify link: nothing anonymous reaches the map, and opening a link never acts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer import tokens
from roamer.config import settings
from roamer.models import EmailToken, Listing, ListingEvent, OutboxMessage, Owner
from tests.conftest import create_live, listing_data, verify_token_for


def pending(session: Session, **overrides) -> Listing:
    return service.create_listing(session, listing_data(**overrides))


def test_a_new_listing_queues_one_verify_email_with_a_hashed_token(db_session: Session) -> None:
    listing = pending(db_session, email="owner@example.com")

    messages = db_session.scalars(
        select(OutboxMessage).where(OutboxMessage.to_address == "owner@example.com")
    ).all()
    assert [m.template for m in messages] == ["verify"]
    token = verify_token_for(db_session, listing)

    stored = db_session.scalars(
        select(EmailToken).where(EmailToken.listing_id == listing.id)
    ).one()
    # Only the hash is stored; the token itself is nowhere in the table.
    assert stored.token_hash == tokens.hash_token(token)
    assert token.encode() not in stored.token_hash


def test_opening_the_link_changes_nothing(client: TestClient, db_session: Session) -> None:
    listing = pending(db_session)
    token = verify_token_for(db_session, listing)

    page = client.get(f"/verify/{token}")

    assert page.status_code == 200
    assert "Publish my listing" in page.text
    db_session.refresh(listing)
    assert listing.status == "pending_verification"
    assert tokens.look_up(db_session, token, purpose="verify").state is tokens.State.VALID


def test_publishing_confirms_the_owner_and_puts_it_on_the_map(db_session: Session) -> None:
    listing = pending(db_session)
    token = verify_token_for(db_session, listing)

    result = service.publish(db_session, token)

    assert result.outcome is service.Verify.PUBLISHED
    db_session.refresh(listing)
    assert listing.status == "lost"
    assert listing.last_confirmed_at is not None
    assert listing.owner.email_confirmed_at is not None
    assert service.is_verified(listing)
    kinds = [e.kind for e in db_session.scalars(
        select(ListingEvent).where(ListingEvent.listing_id == listing.id).order_by(ListingEvent.id)
    )]
    assert kinds == ["created", "verified"]


def test_a_used_link_cannot_publish_twice(client: TestClient, db_session: Session) -> None:
    listing = pending(db_session)
    token = verify_token_for(db_session, listing)
    client.post(f"/verify/{token}")

    again = client.get(f"/verify/{token}")

    assert again.status_code == 200
    assert "Already published" in again.text
    assert service.publish(db_session, token).outcome is service.Verify.ALREADY


def test_an_expired_link_offers_a_new_one_and_the_new_one_works(
    client: TestClient, db_session: Session
) -> None:
    listing = pending(db_session)
    old = verify_token_for(db_session, listing)
    later = datetime.now(timezone.utc) + timedelta(hours=settings.verify_token_hours + 1)

    assert service.check_verify_link(db_session, old, later).outcome is service.Verify.STALE
    assert service.publish(db_session, old, later).outcome is service.Verify.STALE
    db_session.refresh(listing)
    assert listing.status == "pending_verification"

    resent = client.post(f"/verify/{old}/resend", follow_redirects=False)
    assert resent.status_code == 303
    new = verify_token_for(db_session, listing)
    assert new != old
    # The old link is retired the moment a new one is sent.
    assert tokens.look_up(db_session, old, purpose="verify").state is tokens.State.USED
    assert service.publish(db_session, new).outcome is service.Verify.PUBLISHED


def test_an_unknown_link_is_404(client: TestClient) -> None:
    assert client.get("/verify/not-a-real-token").status_code == 404
    assert client.post("/verify/not-a-real-token").status_code == 404


def test_a_pending_listing_is_not_public_anywhere(client: TestClient, db_session: Session) -> None:
    listing = pending(db_session)

    assert client.get(f"/l/{listing.code}").status_code == 404
    pins = client.get("/api/listings", params={"bbox": "-94.7,38.9,-94.4,39.2"}).json()
    assert listing.code not in {pin["code"] for pin in pins}


def test_the_sent_page_masks_the_address(client: TestClient, db_session: Session) -> None:
    listing = pending(db_session, email="sam.jones@example.com")

    page = client.get(f"/listings/sent?code={listing.code}")

    assert "s***@example.com" in page.text
    assert "sam.jones" not in page.text


def test_the_badge_lapses_when_the_owner_goes_quiet(db_session: Session) -> None:
    listing = create_live(db_session, listing_data())
    window = settings.checkin_interval_days + settings.checkin_grace_days
    now = datetime.now(timezone.utc)

    assert service.is_verified(listing, now + timedelta(days=window - 1))
    assert not service.is_verified(listing, now + timedelta(days=window + 1))


def test_unverified_listings_and_their_addresses_are_deleted_after_a_week(
    db_session: Session,
) -> None:
    old = pending(db_session, email="gone@example.com")
    fresh = pending(db_session, email="fresh@example.com")
    live = create_live(db_session, listing_data(email="live@example.com"))
    old.created_at = datetime.now(timezone.utc) - timedelta(
        days=settings.unverified_retention_days + 1
    )
    db_session.commit()
    old_id, fresh_id, live_id = old.id, fresh.id, live.id

    removed = service.delete_unverified(db_session)

    assert removed == 1
    assert db_session.get(Listing, old_id) is None
    assert db_session.get(Listing, fresh_id) is not None
    assert db_session.get(Listing, live_id) is not None
    emails = set(db_session.scalars(select(Owner.email)))
    assert "gone@example.com" not in emails
    assert {"fresh@example.com", "live@example.com"} <= emails
