"""Stage 4: outdoor access, and the index behind "nearest to here".

`outdoor_access` changes the search circle for cats and is kept as a feature for a future
model of where lost pets go.

`listings_active_earth` is a GiST index on ll_to_earth(lat, lng) over active listings only -
the map and the finder's search never look at anything else, so the index holds nothing else.
The distance query in roamer/listings.py uses exactly this expression, which is what lets the
planner use it.

Revision ID: 0005_search
Revises: 0004_photos
Create Date: 2026-10-08
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_search"
down_revision: Union[str, None] = "0004_photos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy. tests/test_schema.py compares it with roamer.circles.
OUTDOOR_ACCESS = ("indoor_only", "indoor_outdoor", "outdoor", "unknown")


def upgrade() -> None:
    quoted = ", ".join(f"'{value}'" for value in OUTDOOR_ACCESS)
    op.add_column(
        "listings",
        sa.Column("outdoor_access", sa.Text(), nullable=False, server_default="unknown"),
    )
    op.create_check_constraint(
        "listings_outdoor_access", "listings", f"outdoor_access IN ({quoted})"
    )
    op.execute(
        "CREATE INDEX listings_active_earth ON listings "
        "USING gist (ll_to_earth(last_seen_lat, last_seen_lng)) "
        "WHERE status = 'lost' AND hidden_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX listings_active_earth")
    op.drop_constraint("listings_outdoor_access", "listings")
    op.drop_column("listings", "outdoor_access")
