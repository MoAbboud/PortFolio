"""initial schema: users, days, stops

Revision ID: 0001
Revises:
Create Date: 2026-06-29

Hand-written initial migration. Subsequent migrations should be produced with
``alembic revision --autogenerate -m "..."``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VIBE = sa.Enum(
    "chill", "foodie", "family", "adventure", "night", "culture", "outdoors", name="vibe"
)
_STOP_TYPE = sa.Enum(
    "restaurant",
    "cafe",
    "event",
    "attraction",
    "outdoors",
    "shop",
    "bar",
    "other",
    name="stop_type",
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "days",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=140), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("vibe", _VIBE, nullable=False),
        sa.Column("city", sa.String(length=140), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("weather", sa.JSON(), nullable=True),
        sa.Column("is_shared", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_days_owner_id", "days", ["owner_id"])

    op.create_table(
        "stops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "day_id",
            sa.Integer(),
            sa.ForeignKey("days.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("type", _STOP_TYPE, nullable=False),
        sa.Column("time", sa.String(length=5), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("event", sa.JSON(), nullable=True),
    )
    op.create_index("ix_stops_day_id", "stops", ["day_id"])


def downgrade() -> None:
    op.drop_index("ix_stops_day_id", table_name="stops")
    op.drop_table("stops")
    op.drop_index("ix_days_owner_id", table_name="days")
    op.drop_table("days")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    # Drop the enum types last (Postgres).
    bind = op.get_bind()
    _STOP_TYPE.drop(bind, checkfirst=True)
    _VIBE.drop(bind, checkfirst=True)
