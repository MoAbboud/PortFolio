"""add log_entries table

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "log_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("logger", sa.String(length=100), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("error_type", sa.String(length=200), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("module", sa.Text(), nullable=True),
        sa.Column("function", sa.String(length=200), nullable=True),
        sa.Column("line", sa.Integer(), nullable=True),
        sa.Column("traceback", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("method", sa.String(length=10), nullable=True),
        sa.Column("path", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_log_entries_created_at", "log_entries", ["created_at"])
    op.create_index("ix_log_entries_level", "log_entries", ["level"])
    op.create_index("ix_log_entries_user_id", "log_entries", ["user_id"])
    op.create_index("ix_log_entries_correlation_id", "log_entries", ["correlation_id"])


def downgrade() -> None:
    op.drop_index("ix_log_entries_correlation_id", table_name="log_entries")
    op.drop_index("ix_log_entries_user_id", table_name="log_entries")
    op.drop_index("ix_log_entries_level", table_name="log_entries")
    op.drop_index("ix_log_entries_created_at", table_name="log_entries")
    op.drop_table("log_entries")
