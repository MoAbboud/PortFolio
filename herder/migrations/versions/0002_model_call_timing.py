"""Split model_calls.latency_ms into load, prompt and generation.

Revision ID: 0002_model_call_timing
Revises: 0001_initial
Create Date: stage 2

`latency_ms` alone was hiding the most important thing stage 2 found. A cold call took
125.6 s of wall clock for 4.8 s of work: 0.8 s of prompt evaluation, 4.0 s of generation, and
121 s loading a 1.9 GB model off disk. With one number there was no way to see that from the
data - the discrepancy was only visible because the CLI happened to print the sub-timings.

The whole reason `model_calls` exists is that re-scoring should be a re-read rather than a
re-run. A question like "did a larger chunk change the ratio of prefill to generation across
twenty conversations" has to be answerable from these rows at stage 10, and with a single
total it is not.

All three are nullable: the heuristic extractor does no inference and has nothing to report,
and a null there means "not applicable" rather than "zero", which is a real distinction.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_model_call_timing"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("model_calls", sa.Column("load_ms", sa.Integer()))
    op.add_column("model_calls", sa.Column("prompt_ms", sa.Integer()))
    op.add_column("model_calls", sa.Column("generation_ms", sa.Integer()))


def downgrade() -> None:
    op.drop_column("model_calls", "generation_ms")
    op.drop_column("model_calls", "prompt_ms")
    op.drop_column("model_calls", "load_ms")
