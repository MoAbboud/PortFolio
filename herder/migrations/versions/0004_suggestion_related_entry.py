"""Stage 7: a suggestion can name a second entry.

Revision ID: 0004_suggestion_related_entry
Revises: 0003_checkpoint_measurement
Create Date: stage 7

A `conflict` suggestion is about two entries: the new claim derive wrote, and the entry a
person holds that it contradicts. Accepting it supersedes theirs with the new one; dismissing
it removes the new one. Both actions need both ids, and the only alternatives were parsing an
id back out of the suggestion's prose or finding the pair again by similarity - one fragile,
the other a guess made at the moment the person has asked for certainty.

`entry_id` stays the entry the suggestion is primarily about (for a conflict, the new claim),
so every existing reader of the column keeps meaning what it meant.

A status check is added while here: `open`, `accepted`, `dismissed`. A suggestion in any other
state is one no inbox would show and no action could leave.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_suggestion_related_entry"
down_revision = "0003_checkpoint_measurement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "suggestions",
        sa.Column("related_entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("entries.id")),
    )
    op.create_check_constraint(
        "ck_suggestions_status", "suggestions", "status in ('open','accepted','dismissed')"
    )
    op.create_index("ix_suggestions_project_status", "suggestions", ["project_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_suggestions_project_status", table_name="suggestions")
    op.drop_constraint("ck_suggestions_status", "suggestions", type_="check")
    op.drop_column("suggestions", "related_entry_id")
