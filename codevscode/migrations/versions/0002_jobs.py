"""The judge's queue.

Revision ID: 0002_jobs
Revises: 0001_baseline
Create Date: 2026-10-21
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_jobs"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB()),
        sa.Column("error", sa.Text()),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("locked_at", sa.DateTime(timezone=True)),
        sa.Column("locked_by", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("kind IN ('judge', 'house')", name="jobs_kind"),
        sa.CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="jobs_status"),
        sa.CheckConstraint("attempts >= 0 AND max_attempts >= 1", name="jobs_attempts"),
    )
    op.create_index("jobs_queued", "jobs", ["id"], postgresql_where=sa.text("status = 'queued'"))
    op.create_index("jobs_running", "jobs", ["locked_at"], postgresql_where=sa.text("status = 'running'"))


def downgrade() -> None:
    op.drop_index("jobs_running", table_name="jobs")
    op.drop_index("jobs_queued", table_name="jobs")
    op.drop_table("jobs")
