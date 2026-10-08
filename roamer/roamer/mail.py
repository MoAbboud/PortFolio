"""Email: queued by the web process, sent by the worker.

Nothing in the web process sends mail. A change that needs an email writes an outbox row in
the same transaction as the change itself, so the two cannot disagree: a listing posted while
the mail relay is down still gets its email when the relay comes back, and a send that keeps
failing becomes a row marked `failed` with the error on it.

Delivery is at least once. A worker that dies between sending and recording the send will
send that message again. A second copy of a verify email is harmless; a lost one is not.
"""

from __future__ import annotations

import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer.config import settings
from roamer.models import OutboxMessage

# Plain text, rendered when the message is sent rather than when it is queued, so the
# outbox holds data and a wording fix applies to everything not yet sent.
_templates = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates" / "email"),
    undefined=StrictUndefined,
    autoescape=False,
    keep_trailing_newline=True,
)

# Payload keys that unlock something. Removed from the row once the message has gone, so the
# outbox does not become a list of working links.
SECRET_KEYS = ("token",)

BATCH = 20


class Mailer(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class SmtpMailer:
    """Sends through an SMTP server: Mailpit in development, a relay for a real service."""

    def send(self, message: EmailMessage) -> None:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password or "")
            smtp.send_message(message)


class RecordingMailer:
    """Keeps what it was asked to send. For tests; never touches the network."""

    def __init__(self, fail_with: Exception | None = None) -> None:
        self.sent: list[EmailMessage] = []
        self.fail_with = fail_with

    def send(self, message: EmailMessage) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.sent.append(message)


def queue(session: Session, *, to: str, template: str, payload: dict) -> OutboxMessage:
    """Add an email to the outbox. The caller's commit is what makes it real."""
    message = OutboxMessage(to_address=to, template=template, payload=payload)
    session.add(message)
    return message


def render(row: OutboxMessage) -> EmailMessage:
    context = {**row.payload, "base_url": settings.base_url.rstrip("/")}
    text = _templates.get_template(f"{row.template}.txt").render(context)
    subject, _, body = text.partition("\n\n")
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = row.to_address
    message["Subject"] = subject.removeprefix("Subject: ").strip()
    message.set_content(body)
    return message


def backoff(attempts: int) -> timedelta:
    """30 s, 1 min, 2 min, 4 min... after the first, second, third failure."""
    return timedelta(seconds=30 * 2 ** max(0, attempts - 1))


def send_due(session: Session, mailer: Mailer, now: datetime | None = None) -> int:
    """Send queued messages that are due. Returns how many were sent.

    Each row is locked while it is worked on (SKIP LOCKED, so a second worker takes other
    rows rather than waiting), and committed on its own, so one bad message cannot hold back
    or undo the others.
    """
    now = now or datetime.now(timezone.utc)
    sent = 0
    ids = session.scalars(
        select(OutboxMessage.id)
        .where(OutboxMessage.status == "queued", OutboxMessage.next_attempt_at <= now)
        .order_by(OutboxMessage.id)
        .limit(BATCH)
    ).all()

    for message_id in ids:
        row = session.scalars(
            select(OutboxMessage)
            .where(OutboxMessage.id == message_id, OutboxMessage.status == "queued")
            .with_for_update(skip_locked=True)
        ).one_or_none()
        if row is None:
            session.rollback()
            continue

        row.attempts += 1
        try:
            mailer.send(render(row))
        except Exception as exc:  # noqa: BLE001 - every failure is recorded, none is fatal
            # The class and message, cut short. An SMTP error carries the server's reply,
            # not our credentials.
            row.last_error = f"{type(exc).__name__}: {exc}"[:500]
            if row.attempts >= settings.outbox_max_attempts:
                row.status = "failed"
            else:
                row.next_attempt_at = now + backoff(row.attempts)
        else:
            row.status = "sent"
            row.sent_at = now
            row.last_error = None
            row.payload = {k: v for k, v in row.payload.items() if k not in SECRET_KEYS}
            sent += 1
        session.commit()
    return sent
