"""Photos.

One row per uploaded image. The image itself is in the image store, twice - a display size
and a thumbnail - under `storage_key`. At most one flyer per listing, enforced here rather
than trusted to the form.

Revision ID: 0004_photos
Revises: 0003_email
Create Date: 2026-10-08
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_photos"
down_revision: Union[str, None] = "0003_email"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy, as in 0002. tests/test_schema.py compares it with roamer.models.
PHOTO_KINDS = ("photo", "flyer")


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "listing_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False, unique=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind IN ('photo', 'flyer')", name="photos_kind"),
        sa.CheckConstraint("position >= 0", name="photos_position"),
        sa.CheckConstraint("width > 0 AND height > 0", name="photos_size"),
        sa.UniqueConstraint("listing_id", "kind", "position", name="photos_order"),
    )
    op.create_index(
        "photos_one_flyer",
        "photos",
        ["listing_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'flyer'"),
    )


def downgrade() -> None:
    op.drop_table("photos")
