"""The outbox: queued with the change, sent by the worker, failures recorded rather than lost."""

from __future__ import annotations

import smtplib
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer import mail
from roamer.config import settings
from roamer.models import OutboxMessage
from tests.conftest import listing_data, verify_token_for


def outbox_for(session: Session, address: str) -> OutboxMessage:
    return session.scalars(
        select(OutboxMessage).where(OutboxMessage.to_address == address)
    ).one()


def test_a_queued_email_is_sent_with_a_working_link(db_session: Session) -> None:
    listing = service.create_listing(
        db_session, listing_data(name="Biscuit", email="send@example.com")
    )
    token = verify_token_for(db_session, listing)
    mailer = mail.RecordingMailer()

    sent = mail.send_due(db_session, mailer)

    assert sent >= 1
    message = next(m for m in mailer.sent if m["To"] == "send@example.com")
    assert message["Subject"] == "Confirm your listing for Biscuit"
    body = message.get_content()
    assert f"{settings.base_url.rstrip('/')}/verify/{token}" in body

    row = outbox_for(db_session, "send@example.com")
    assert row.status == "sent"
    assert row.sent_at is not None
    # Once sent, the row no longer holds a working link.
    assert "token" not in row.payload
    assert row.payload["code"] == listing.code


def test_a_failed_send_is_kept_and_retried_later(db_session: Session) -> None:
    service.create_listing(db_session, listing_data(email="flaky@example.com"))
    now = datetime.now(timezone.utc)
    mailer = mail.RecordingMailer(fail_with=smtplib.SMTPServerDisconnected("relay went away"))

    mail.send_due(db_session, mailer, now)

    row = outbox_for(db_session, "flaky@example.com")
    assert row.status == "queued"
    assert row.attempts == 1
    assert row.last_error == "SMTPServerDisconnected: relay went away"
    assert row.next_attempt_at > now
    # Still holding its token: it has not been delivered.
    assert "token" in row.payload

    # Not due yet, so not tried again yet.
    mail.send_due(db_session, mailer, now + timedelta(seconds=1))
    assert outbox_for(db_session, "flaky@example.com").attempts == 1


def test_a_message_that_keeps_failing_is_marked_failed(db_session: Session) -> None:
    service.create_listing(db_session, listing_data(email="dead@example.com"))
    mailer = mail.RecordingMailer(fail_with=OSError("no route to host"))
    when = datetime.now(timezone.utc)

    for _ in range(settings.outbox_max_attempts):
        mail.send_due(db_session, mailer, when)
        when += timedelta(days=1)

    row = outbox_for(db_session, "dead@example.com")
    assert row.status == "failed"
    assert row.attempts == settings.outbox_max_attempts

    # A failed message is not tried again.
    mail.send_due(db_session, mail.RecordingMailer(), when)
    assert outbox_for(db_session, "dead@example.com").status == "failed"


def test_the_listing_survives_a_send_failure(db_session: Session) -> None:
    # The point of the outbox: the listing and its email are committed together, and the
    # send happening later, or failing, cannot undo the listing.
    listing = service.create_listing(db_session, listing_data(email="down@example.com"))
    mail.send_due(db_session, mail.RecordingMailer(fail_with=ConnectionRefusedError()))

    db_session.refresh(listing)
    assert listing.status == "pending_verification"
    assert verify_token_for(db_session, listing)


def test_backoff_doubles() -> None:
    assert [mail.backoff(n).total_seconds() for n in (1, 2, 3, 4)] == [30, 60, 120, 240]
