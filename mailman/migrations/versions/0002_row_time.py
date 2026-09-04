"""extractions.created_at and validation_results.checked_at use clock_timestamp

Postgres `now()` is transaction start time, so every row written inside one transaction
shares it to the microsecond. Applying a correction writes a second extraction in the same
transaction as the first is read, so both carried an identical `created_at` and "the latest
extraction" was resolved arbitrarily by the planner - validation ran against the uncorrected
answer roughly half the time, silently.

The same applies to `validation_results.checked_at`, which the review page uses to show only
the newest set of verdicts. With a shared timestamp it showed every verdict a document had
ever had, stacked.

Only these two columns change. The other `now()` defaults are records of when something
happened and nothing sorts on them to pick a winner.

Revision ID: 0002_row_time
Revises: 0001_seven_tables
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_row_time"
down_revision = "0001_seven_tables"
branch_labels = None
depends_on = None

_COLUMNS = (("extractions", "created_at"), ("validation_results", "checked_at"))


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table, column, server_default=sa.text("clock_timestamp()"),
            existing_type=sa.DateTime(timezone=True), existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table, column, server_default=sa.text("now()"),
            existing_type=sa.DateTime(timezone=True), existing_nullable=False,
        )
