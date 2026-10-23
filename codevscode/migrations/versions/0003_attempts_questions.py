"""Attempts and the questions asked in them (stage 3).

Revision ID: 0003_attempts_questions
Revises: 0002_jobs
Create Date: 2026-10-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_attempts_questions"
down_revision: Union[str, None] = "0002_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("challenge", sa.Text(), nullable=False),
        sa.Column("challenge_version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False, server_default="practice"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("mode IN ('practice', 'ranked')", name="attempts_mode"),
    )
    op.create_table(
        "questions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("attempt_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("requirement", sa.Text()),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("revealed", sa.Boolean(), nullable=False),
        sa.Column("matcher", sa.Text(), nullable=False),
        sa.Column("asked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("questions_by_attempt", "questions", ["attempt_id", "asked_at"])


def downgrade() -> None:
    op.drop_index("questions_by_attempt", table_name="questions")
    op.drop_table("questions")
    op.drop_table("attempts")
