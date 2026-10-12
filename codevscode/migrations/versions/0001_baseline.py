"""Baseline. No tables yet - the judge's jobs table arrives at stage 2.

It exists so `alembic upgrade head` has something to run from the first commit, and so
/health can tell a migrated database from one nobody has run the migrations on.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-12
"""

from __future__ import annotations

from typing import Sequence, Union

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
