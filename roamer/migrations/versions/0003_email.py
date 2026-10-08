"""Email links and the outbox.

`email_tokens` holds only the SHA-256 of each link's token, so a database dump cannot be
used to publish, manage or answer for anyone's listing. `outbox` is every email the site
means to send, written in the same transaction as the change that caused it and sent by the
worker; a failed send is a row with an error on it rather than a log line.

Revision ID: 0003_email
Revises: 0002_listings
Create Date: 2026-10-08
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_email"
down_revision: Union[str, None] = "0002_listings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies, as in 0002. tests/test_schema.py compares them with roamer.models.
TOKEN_PURPOSES = ("verify", "manage", "checkin")
OUTBOX_STATUSES = ("queued", "sent", "failed")
OUTBOX_TEMPLATES = ("verify", "manage", "checkin", "report_received")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def upgrade() -> None:
    op.create_table(
        "email_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "listing_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(_in("purpose", TOKEN_PURPOSES), name="email_tokens_purpose"),
        # SHA-256 is 32 bytes. A shorter value is a bug that would make every lookup miss.
        sa.CheckConstraint("octet_length(token_hash) = 32", name="email_tokens_hash_length"),
    )
    op.create_index("email_tokens_listing_id", "email_tokens", ["listing_id"])

    op.create_table(
        "outbox",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("to_address", postgresql.CITEXT(), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column(
            "payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_error", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(_in("status", OUTBOX_STATUSES), name="outbox_status"),
        sa.CheckConstraint(_in("template", OUTBOX_TEMPLATES), name="outbox_template"),
    )
    # What the worker asks for every few seconds: queued messages that are due.
    op.create_index(
        "outbox_due",
        "outbox",
        ["next_attempt_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )


def downgrade() -> None:
    op.drop_table("outbox")
    op.drop_table("email_tokens")
