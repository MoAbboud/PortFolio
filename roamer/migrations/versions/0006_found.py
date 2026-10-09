"""Where and how a lost animal was found - the other half of every reunion.

roamer is a data collector for a future model of where lost pets go, and no public dataset
pairs a lost point with a found point. These columns are that pair's second half. All
optional: the owner is asked, not required. Never shown publicly - a found point can be close
to the owner's home.

Brought forward from stage 6 to stage 5, because the check-in email's "home" answer is the
first way an animal is marked home, and a reunion recorded without these is a data point lost.

Revision ID: 0006_found
Revises: 0005_search
Create Date: 2026-10-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_found"
down_revision: Union[str, None] = "0005_search"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy. tests/test_schema.py compares it with roamer.models.
FOUND_HOW = (
    "came_home",
    "neighbour",
    "flyer",
    "roamer",
    "shelter",
    "microchip",
    "social_media",
    "other",
)


def upgrade() -> None:
    op.add_column("listings", sa.Column("found_lat", sa.Float()))
    op.add_column("listings", sa.Column("found_lng", sa.Float()))
    op.add_column("listings", sa.Column("found_at", sa.DateTime(timezone=True)))
    op.add_column("listings", sa.Column("found_how", sa.Text()))
    quoted = ", ".join(f"'{value}'" for value in FOUND_HOW)
    op.create_check_constraint(
        "listings_found_how", "listings", f"found_how IS NULL OR found_how IN ({quoted})"
    )
    # A point is both coordinates or neither, and on the planet.
    op.create_check_constraint(
        "listings_found_point",
        "listings",
        "(found_lat IS NULL) = (found_lng IS NULL) "
        "AND (found_lat IS NULL OR found_lat BETWEEN -90 AND 90) "
        "AND (found_lng IS NULL OR found_lng BETWEEN -180 AND 180)",
    )


def downgrade() -> None:
    op.drop_constraint("listings_found_point", "listings")
    op.drop_constraint("listings_found_how", "listings")
    for column in ("found_how", "found_at", "found_lng", "found_lat"):
        op.drop_column("listings", column)
